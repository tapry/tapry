// Clips: a stretch of a finished recording cut out as a file of its own.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseClock } from "../src/components/clips-card";
import { clipFileName, MAX_CLIPS } from "../src/server/clips";
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
    expect([made.status, made.body]).toEqual([201, { id: expect.stringMatching(/^clp_/), startMs: 1_190_000, endMs: 1_200_000, title: "The ending", status: "queued", output: null }]);
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
});
