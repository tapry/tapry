// Clips: a stretch of a finished recording cut out as a file of its own.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseClock } from "../src/components/clips-card";
import { captionsAss, CLIP_FRAMES, clipFileName, clipTiles, MAX_CLIPS, shapedClipArgs } from "../src/server/clips";
import { JobRunner } from "../src/server/jobs";
import { FakeStorage, setup } from "./harness";

const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe";
const hasFfmpeg = (() => {
  try {
    execFileSync(ffmpeg, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const ORIGIN = { origin: "https://app.test" };

describe("clips", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let storage: FakeStorage;
  beforeEach(async () => {
    storage = new FakeStorage();
    t = await setup(storage);
  });
  const path = () => `/studios/${t.studio.id}/recordings/${t.recordingId}/clips`;
  /** The recording stopped after `seconds`, processed, with this as its combined file. */
  async function ready(seconds: number, file: { name: string; data: Buffer | string; type: string }) {
    t.tick(seconds * 1000);
    await t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
    const key = `outputs/${t.sessionId}/${t.recordingId}/out_c.${file.name.split(".").pop()}`;
    storage.put(key, file.data, file.type);
    await t.db.query("UPDATE recordings SET processing = 'ready', processed_at = now() WHERE id = $1", [t.recordingId]);
    await t.db.query("INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes) VALUES ('out_c', $1, 'combined', $2, $3, $4, 1)", [t.recordingId, file.name, file.type, key]);
  }

  it("reads times as people type them, and names files so they sort", () => {
    expect([parseClock("1:05"), parseClock("65"), parseClock("1:02:03"), parseClock("0:07.5"), parseClock("soon"), parseClock("")]).toEqual([65_000, 65_000, 3_723_000, 7500, null, null]);
    expect(clipFileName({ startMs: 65_000, endMs: 150_000, title: "The hard year" }, "mp4")).toBe("Clip 01.05-02.30 - The hard year.mp4");
    expect(clipFileName({ startMs: 3_723_000, endMs: 3_730_000, title: 'a/b: "c"?' }, "wav")).toBe("Clip 1.02.03-1.02.10 - a b c.wav");
  });

  it("are asked for on a finished recording, inside it, between a second and ten minutes", async () => {
    expect((await t.hostBrowser.post(path(), { startMs: 0, endMs: 5000 }, ORIGIN)).body.error).toBe("not_ready");
    await ready(1200, { name: "Combined.mp4", data: "x", type: "video/mp4" });
    expect((await t.hostBrowser.post(path(), { startMs: 5000, endMs: 5500 }, ORIGIN)).body.error).toBe("clip_too_short");
    expect((await t.hostBrowser.post(path(), { startMs: 0, endMs: 601_000 }, ORIGIN)).body.error).toBe("clip_too_long");
    // Past the end is cut back to the end.
    const made = await t.hostBrowser.post(path(), { startMs: 1_190_000, endMs: 1_300_000, title: "The ending" }, ORIGIN);
    expect([made.status, made.body]).toEqual([201, { id: expect.stringMatching(/^clp_/), startMs: 1_190_000, endMs: 1_200_000, title: "The ending", shape: "wide", captions: false, status: "queued", output: null }]);
    // A shape needs someone's camera, captions need a transcript.
    expect((await t.hostBrowser.post(path(), { startMs: 0, endMs: 5000, shape: "vertical" }, ORIGIN)).body.error).toBe("no_cameras");
    expect((await t.hostBrowser.post(path(), { startMs: 0, endMs: 5000, captions: true }, ORIGIN)).body.error).toBe("no_transcript");
    expect((await t.hostBrowser.post(path(), { startMs: 0, endMs: 5000, shape: "round" }, ORIGIN)).status).toBe(400);
    expect(await t.db.query("SELECT type, status FROM jobs WHERE type = 'clip_recording'")).toEqual([{ type: "clip_recording", status: "queued" }]);
    expect((await t.client().get(path())).status).toBe(401);
    for (let i = 1; i < MAX_CLIPS; i++) await t.db.query("INSERT INTO clips (id, recording_id, start_ms, end_ms) VALUES ($1, $2, 0, 2000)", [`clp_fill${i}`, t.recordingId]);
    expect((await t.hostBrowser.post(path(), { startMs: 0, endMs: 5000 }, ORIGIN)).status).toBe(429);
  });

  it.skipIf(!hasFfmpeg)("are cut from the combined video, exact to the frame, and deleted with their file", { timeout: 120_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "tapry-clip-test-"));
    const combined = join(dir, "Combined.mp4");
    execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=12", "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", combined], { stdio: "ignore" });
    await ready(12, { name: "Combined.mp4", data: readFileSync(combined), type: "video/mp4" });
    await t.hostBrowser.post(path(), { startMs: 2000, endMs: 5500, title: "Middle" }, ORIGIN);
    await new JobRunner(t.db, storage, { ffmpeg, ffprobe }).drain();

    const [clip] = (await t.hostBrowser.get(path())).body.clips;
    expect(clip).toMatchObject({ status: "ready", output: { fileName: "Clip 00.02-00.05 - Middle.mp4" } });
    const [out] = await t.db.query<{ storage_key: string; kind: string }>("SELECT storage_key, kind FROM outputs WHERE id = $1", [clip.output.id]);
    expect(out!.kind).toBe("clip");
    expect(out!.storage_key).toMatch(new RegExp(`^outputs/${t.sessionId}/${t.recordingId}/`));
    const file = join(dir, "clip.mp4");
    writeFileSync(file, storage.objects.get(out!.storage_key)!.data);
    const probe = execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "csv=p=0", file]).toString();
    expect(probe).toContain("video");
    expect(probe).toContain("audio");
    expect(Number(probe.trim().split("\n").at(-1))).toBeCloseTo(3.5, 1);
    // Listed with the recording's files.
    const listed = (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body.recordings[0];
    expect(listed.outputs.map((o: { kind: string }) => o.kind)).toContain("clip");

    expect((await t.hostBrowser.del(`${path()}/${clip.id}`, ORIGIN)).status).toBe(204);
    expect(storage.objects.has(out!.storage_key)).toBe(false);
    expect((await t.hostBrowser.get(path())).body.clips).toEqual([]);
    expect(await t.db.query("SELECT 1 FROM outputs WHERE kind = 'clip'")).toEqual([]);
  });

  it("lays people out so their pictures are cut as little as possible", () => {
    // Vertical: one above the other, never slivers side by side.
    expect(clipTiles(1, CLIP_FRAMES.vertical)).toEqual([{ x: 0, y: 0, w: 1080, h: 1920 }]);
    expect(clipTiles(2, CLIP_FRAMES.vertical)).toEqual([{ x: 0, y: 0, w: 1080, h: 960 }, { x: 0, y: 960, w: 1080, h: 960 }]);
    expect(clipTiles(3, CLIP_FRAMES.vertical).map((t) => [t.w, t.h])).toEqual([[1080, 640], [1080, 640], [1080, 640]]);
    // Square: two stacked (wide tiles), four as two by two.
    expect(clipTiles(2, CLIP_FRAMES.square).map((t) => [t.x, t.y, t.w, t.h])).toEqual([[0, 0, 1080, 540], [0, 540, 1080, 540]]);
    expect(clipTiles(4, CLIP_FRAMES.square).map((t) => [t.x, t.y])).toEqual([[0, 0], [540, 0], [0, 540], [540, 540]]);
    // Everyone is inside the frame, nobody on top of anyone, for any number.
    for (const shape of ["square", "vertical"] as const) {
      for (let n = 1; n <= 10; n++) {
        const tiles = clipTiles(n, CLIP_FRAMES[shape]);
        expect(tiles).toHaveLength(n);
        for (const [i, a] of tiles.entries()) {
          expect(a.x >= 0 && a.y >= 0 && a.x + a.w <= CLIP_FRAMES[shape].w && a.y + a.h <= CLIP_FRAMES[shape].h, `${shape} ${n}`).toBe(true);
          for (const b of tiles.slice(i + 1)) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${shape} ${n} overlap`).toBe(true);
        }
      }
    }
  });

  it("writes captions a few words at a time, only what is said inside the clip, with nothing read as formatting", () => {
    const cues = [
      { startMs: 0, endMs: 4000, text: "Before the clip begins." },
      { startMs: 9000, endMs: 15_000, text: "The lighthouse keeper kept a {\\b1}log of every ship that passed in the night." },
      { startMs: 19_000, endMs: 30_000, text: "And then it ends, long after the clip." },
    ];
    const ass = captionsAss(cues, 10_000, 20_000, "vertical");
    expect(ass).toContain("PlayResX: 1080\nPlayResY: 1920");
    const lines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    const text = lines.map((l) => l.split(",,").at(-1));
    expect(text.join(" ")).not.toContain("Before");
    expect(text.join(" ")).not.toMatch(/[{}\\]/);
    expect(text.every((t) => t!.length <= 36)).toBe(true);
    expect(text.join(" ")).toContain("of every ship");
    // Times are from the clip's start, in order, inside the clip.
    const times = lines.map((l) => l.split(",").slice(1, 3));
    expect(times[0]![0]).toBe("0:00:00.00"); // the line began a second before the clip: its part in the clip starts with it
    expect(times.at(-1)![1]).toBe("0:00:10.00");
    for (const [i, [a, b]] of times.entries()) {
      expect(a! < b!).toBe(true);
      if (i > 0) expect(a! >= times[i - 1]![1]!).toBe(true);
    }
    // Wide captions are smaller on a wider frame.
    expect(captionsAss(cues, 10_000, 20_000, "wide")).toContain("PlayResX: 1920");
  });

  it("builds the ffmpeg command: wide from the combined video, other shapes from the cameras with the mix's sound", () => {
    const wide = shapedClipArgs({ combined: "/w/c.mp4", people: [], out: "/w/o.mp4", startMs: 2000, endMs: 5500, shape: "wide", ass: "/w/a:b's.ass" });
    expect(wide.slice(0, 9)).toEqual(["-y", "-hide_banner", "-nostdin", "-ss", "2.000", "-t", "3.500", "-i", "/w/c.mp4"]);
    expect(wide[wide.indexOf("-vf") + 1]).toBe("ass='/w/a\\:b'\\''s.ass'");
    const tall = shapedClipArgs({ combined: "/w/c.mp4", people: ["/w/p1.mp4", "/w/p2.mp4"], out: "/w/o.mp4", startMs: 0, endMs: 4000, shape: "vertical", fps: "25" });
    expect(tall.filter((a) => a === "-i")).toHaveLength(3);
    const graph = tall[tall.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("color=c=0x202020:s=1080x1920:r=25:d=4.000[base]");
    expect(graph).toContain("[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[t0]");
    expect(graph).toContain("[c0][t1]overlay=x=0:y=960:shortest=0[c1]");
    expect(graph).not.toContain("ass=");
    expect(tall.slice(tall.indexOf("-map"), tall.indexOf("-map") + 4)).toEqual(["-map", "[v]", "-map", "0:a:0?"]);
  });

  it.skipIf(!hasFfmpeg)("cuts a vertical clip with captions from two people's cameras", { timeout: 180_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "tapry-clip-shape-"));
    const make = (name: string, src: string) => {
      const file = join(dir, name);
      execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", `${src}=size=640x360:rate=30:duration=12`, "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", file], { stdio: "ignore" });
      return readFileSync(file);
    };
    await ready(12, { name: "Combined.mp4", data: make("Combined.mp4", "testsrc"), type: "video/mp4" });
    for (const [id, name, src] of [["out_p1", "Host - video.mp4", "testsrc2"], ["out_p2", "Sam Guest - video.mp4", "smptebars"]] as const) {
      const key = `outputs/${t.sessionId}/${t.recordingId}/${id}.mp4`;
      storage.put(key, make(name, src), "video/mp4");
      await t.db.query("INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes) VALUES ($1, $2, 'video', $3, 'video/mp4', $4, 1)", [id, t.recordingId, name, key]);
    }
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:06.000\n<v Host>Welcome back to the lighthouse, where the log is kept every night.\n";
    const vttKey = `outputs/${t.sessionId}/${t.recordingId}/out_t.vtt`;
    storage.put(vttKey, vtt, "text/vtt");
    await t.db.query("INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes) VALUES ('out_t', $1, 'transcript', 'Transcript.vtt', 'text/vtt', $2, 1)", [t.recordingId, vttKey]);
    await t.db.query("UPDATE recordings SET transcript = 'ready' WHERE id = $1", [t.recordingId]);

    const made = await t.hostBrowser.post(path(), { startMs: 1000, endMs: 5000, title: "Opening", shape: "vertical", captions: true }, ORIGIN);
    expect(made.body).toMatchObject({ shape: "vertical", captions: true });
    await new JobRunner(t.db, storage, { ffmpeg, ffprobe }).drain();

    const [clip] = (await t.hostBrowser.get(path())).body.clips;
    expect(clip).toMatchObject({ status: "ready", shape: "vertical", captions: true, output: { fileName: "Clip 00.01-00.05 - Opening (vertical).mp4" } });
    const [out] = await t.db.query<{ storage_key: string }>("SELECT storage_key FROM outputs WHERE id = $1", [clip.output.id]);
    const file = join(dir, "clip.mp4");
    writeFileSync(file, storage.objects.get(out!.storage_key)!.data);
    const probe = execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "csv=p=0", file]).toString().trim().split("\n");
    expect(probe[0]).toBe("1080,1920");
    expect(Number(probe.at(-1))).toBeCloseTo(4, 1);
    expect(execFileSync(ffprobe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file]).toString()).toContain("audio");
    // Captions were drawn: white text in the lower part of the frame, where the same clip without them has none.
    await t.hostBrowser.post(path(), { startMs: 1000, endMs: 5000, shape: "vertical" }, ORIGIN);
    await new JobRunner(t.db, storage, { ffmpeg, ffprobe }).drain();
    const plain = (await t.hostBrowser.get(path())).body.clips.find((c: { captions: boolean }) => !c.captions);
    const [plainOut] = await t.db.query<{ storage_key: string }>("SELECT storage_key FROM outputs WHERE id = $1", [plain.output.id]);
    const plainFile = join(dir, "plain.mp4");
    writeFileSync(plainFile, storage.objects.get(plainOut!.storage_key)!.data);
    const differs = execFileSync(ffmpeg, ["-v", "error", "-ss", "2", "-i", file, "-ss", "2", "-i", plainFile, "-frames:v", "1", "-filter_complex", "[0:v][1:v]blend=all_mode=difference,crop=1080:400:0:1300,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-", "-f", "null", "-"]).toString();
    expect(Number.parseFloat(differs.match(/YMAX=([\d.]+)/)![1]!)).toBeGreaterThan(100);
  });
});
