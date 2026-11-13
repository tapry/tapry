// Project files for editors: every finished file on its own track from 0, markers included.
import { writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { toFcpxml, toOtio, toReaper, type TimelineInput } from "../src/server/timeline-export";
import { setup } from "./harness";

const input: TimelineInput = {
  title: "My Podcast, Recording 3",
  durationMs: 61_500,
  frameRate: "25",
  files: [
    { fileName: "Host - audio.wav", kind: "audio", person: "Host" },
    { fileName: "Host - video.mp4", kind: "video", person: "Host" },
    { fileName: "Sam & Co - audio.flac", kind: "audio", person: "Sam & Co" },
    { fileName: "Sam & Co - screen.mp4", kind: "screen", person: "Sam & Co" },
  ],
  markers: [{ atMs: 12_000, label: 'The "hard" year <1>' }],
};

describe("timeline exports", () => {
  it("OpenTimelineIO: a track per file, pictures first, all from frame 0 for the whole length, with markers", () => {
    const otio = JSON.parse(toOtio(input));
    if (process.env.TIMELINE_SAMPLES) writeFileSync(`${process.env.TIMELINE_SAMPLES}/Timeline.otio`, toOtio(input));
    expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
    const tracks = otio.tracks.children;
    expect(tracks.map((t: any) => [t.kind, t.name])).toEqual([["Video", "Host"], ["Video", "Sam & Co (screen)"], ["Audio", "Host"], ["Audio", "Sam & Co"]]);
    for (const t of tracks) {
      const clip = t.children[0];
      expect(clip.source_range).toEqual({ OTIO_SCHEMA: "TimeRange.1", start_time: { OTIO_SCHEMA: "RationalTime.1", rate: 25, value: 0 }, duration: { OTIO_SCHEMA: "RationalTime.1", rate: 25, value: 1538 } });
    }
    expect(tracks[3].children[0].media_reference.target_url).toBe("Sam%20%26%20Co%20-%20audio.flac");
    expect(otio.tracks.markers.map((m: any) => [m.name, m.marked_range.start_time.value])).toEqual([['The "hard" year <1>', 300]]);
  });

  it("Final Cut XML: whole frames at the studio's rate, names escaped, markers in place", () => {
    const xml = toFcpxml(input);
    if (process.env.TIMELINE_SAMPLES) writeFileSync(`${process.env.TIMELINE_SAMPLES}/Timeline.fcpxml`, xml);
    expect(xml).toContain('<format id="r1" name="FFVideoFormat1080p25" frameDuration="1/25s" width="1920" height="1080"/>');
    expect(xml).toContain('<sequence format="r1" duration="1538/25s"');
    expect(xml).toContain('src="./Sam%20%26%20Co%20-%20screen.mp4"');
    expect(xml).toContain('name="Sam &amp; Co (screen)"');
    expect(xml).toContain('<marker start="300/25s" duration="1/25s" value="The &quot;hard&quot; year &lt;1&gt;"/>');
    // Pictures stack up, sound down.
    expect([...xml.matchAll(/lane="(-?\d+)"/g)].map((m) => m[1])).toEqual(["1", "-1", "-2"]);
    // 29.97 is exactly 30000/1001.
    expect(toFcpxml({ ...input, frameRate: "29.97", durationMs: 10_010 })).toContain('frameDuration="1001/30000s"');
    expect(toFcpxml({ ...input, frameRate: "29.97", durationMs: 10_010 })).toContain('duration="300300/30000s"');
  });

  it("REAPER: each person's audio on a track of its own, markers in seconds", () => {
    const rpp = toReaper(input);
    if (process.env.TIMELINE_SAMPLES) writeFileSync(`${process.env.TIMELINE_SAMPLES}/Timeline.rpp`, rpp);
    expect(rpp.match(/<TRACK/g)!.length).toBe(2);
    expect(rpp).toContain('<SOURCE WAVE\n        FILE "Host - audio.wav"');
    expect(rpp).toContain('<SOURCE FLAC\n        FILE "Sam & Co - audio.flac"');
    expect(rpp).toContain("LENGTH 61.500000");
    expect(rpp).toContain(`MARKER 1 12.000000 "The 'hard' year <1>" 0`);
    expect(() => toReaper({ ...input, files: input.files.filter((f) => f.kind !== "audio") })).toThrow(/no audio/);
  });
});

describe("timeline downloads", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });

  it("are for a finished recording of your own, by format", async () => {
    const path = (format: string) => `/studios/${t.studio.id}/recordings/${t.recordingId}/timeline/${format}`;
    expect((await t.hostBrowser.get(path("otio"))).status).toBe(409); // still recording
    await t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
    await t.db.query("UPDATE recordings SET processing = 'ready' WHERE id = $1", [t.recordingId]);
    await t.db.query(
      `INSERT INTO outputs (id, recording_id, participant_id, kind, file_name, content_type, storage_key, bytes, duration_ms)
       VALUES ('out_a', $1, $2, 'audio', 'Guest - audio.wav', 'audio/wav', 'outputs/x/a.wav', 10, 4000),
              ('out_c', $1, NULL, 'combined', 'Combined.wav', 'audio/wav', 'outputs/x/c.wav', 10, 4000)`,
      [t.recordingId, t.guest.participantId],
    );
    await t.db.query("INSERT INTO markers (id, recording_id, at_ms, label) VALUES ('mrk_1', $1, 1500, 'First question')", [t.recordingId]);
    const res = await t.fetchFor()(`https://app.test/api${path("rpp")}`, { headers: { cookie: `ot_session=${t.hostBrowser.jar.get("ot_session")}` } });
    expect([res.status, res.headers.get("content-disposition")]).toEqual([200, expect.stringContaining("Timeline.rpp")]);
    const rpp = await res.text();
    expect(rpp).toContain('FILE "Guest - audio.wav"'); // the person's file, not the mix
    expect(rpp).not.toContain("Combined");
    expect(rpp).toContain('MARKER 1 1.500000 "First question" 0');
    expect((await t.hostBrowser.get(path("premiere"))).status).toBe(404);
    expect((await t.client().get(path("otio"))).status).toBe(401);
  });
});
