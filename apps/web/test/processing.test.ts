import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkStorageKey } from "@opentake/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { JobRunner } from "../src/server/jobs";
import { FakeStorage, setup, sha256 } from "./harness";

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

const MIME = "audio/webm;codecs=opus";

describe("recording processing", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let storage: FakeStorage;

  beforeEach(async () => {
    storage = new FakeStorage();
    t = await setup(storage);
  });

  const host = () => t.client({ token: t.host.token });
  const stop = () => host().post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
  const processing = async () =>
    (await t.db.query<{ processing: string }>("SELECT processing FROM recordings WHERE id = $1", [t.recordingId]))[0]!
      .processing;
  const jobs = () => t.db.query<{ status: string }>("SELECT status FROM jobs WHERE recording_id = $1", [t.recordingId]);

  /** Register a track for the guest and upload `parts` as its chunks, the way the recorder does. */
  async function uploadTrack(parts: Buffer[], opts: { complete?: boolean; token?: string; kind?: "audio" | "video" } = {}) {
    const token = opts.token ?? t.guest.token;
    const { trackId } = (
      await t.call(
        `/sessions/${t.sessionId}/tracks`,
        { recordingId: t.recordingId, kind: opts.kind ?? "audio", mimeType: MIME, startedAt: t.now() },
        token,
      )
    ).body;
    for (const [seq, data] of parts.entries()) {
      const meta = { bytes: data.length, sha256: sha256(data) };
      await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/upload-url`, { ...meta, mimeType: MIME }, token);
      storage.put(chunkStorageKey(t.sessionId, trackId, seq), data);
      await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/commit`, { ...meta, startTs: t.now(), endTs: t.now() + 1 }, token);
    }
    if (opts.complete !== false) {
      await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq: parts.length - 1 }, token);
    }
    return trackId as string;
  }

  describe("when processing is queued", () => {
    it("waits for the last upload after Stop", async () => {
      const trackId = await uploadTrack([Buffer.from("a")], { complete: false });
      await stop();
      expect(await processing()).toBe("pending");
      expect(await jobs()).toEqual([]);

      await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq: 0 });
      expect(await processing()).toBe("queued");
      expect(await jobs()).toEqual([{ status: "queued" }]);
    });

    it("queues on Stop when every track is already uploaded", async () => {
      await uploadTrack([Buffer.from("a")]);
      expect(await processing()).toBe("pending"); // still recording
      await stop();
      expect(await processing()).toBe("queued");
    });

    it("queues when the host ends the session", async () => {
      await uploadTrack([Buffer.from("a")]);
      await host().post(`/sessions/${t.sessionId}/end`);
      expect(await processing()).toBe("queued");
    });

    it("never queues twice for the same recording", async () => {
      await uploadTrack([Buffer.from("a")]);
      await stop();
      await stop();
      await t.services.processing.enqueue(t.recordingId);
      expect(await jobs()).toHaveLength(1);
    });
  });

  describe("host controls", () => {
    it("processes without a guest who never finished uploading", async () => {
      await uploadTrack([Buffer.from("a")], { complete: false });
      await stop();
      const res = await t.hostBrowser.post(`/studios/${t.studio.id}/recordings/${t.recordingId}/process`);
      expect(res.status).toBe(202);
      expect(await processing()).toBe("queued");
    });

    it("refuses to process a recording that is still running", async () => {
      const res = await t.hostBrowser.post(`/studios/${t.studio.id}/recordings/${t.recordingId}/process`);
      expect(res).toMatchObject({ status: 409, body: { error: "still_recording" } });
    });

    it("keeps other hosts out", async () => {
      await stop();
      const stranger = t.client();
      expect((await stranger.get(`/studios/${t.studio.id}/recordings`)).status).toBe(401);
      expect((await stranger.post(`/studios/${t.studio.id}/recordings/${t.recordingId}/process`)).status).toBe(401);
    });

    it("lists recordings with their state", async () => {
      await uploadTrack([Buffer.from("a")], { complete: false });
      await stop();
      const { recordings } = (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body;
      expect(recordings).toEqual([
        expect.objectContaining({ id: t.recordingId, status: "stopped", processing: "pending", tracks: 1, incompleteTracks: 1, outputs: [] }),
      ]);
    });
  });

  describe.skipIf(!hasFfmpeg)("job runner with ffmpeg", () => {
    let media: Buffer;

    beforeEach(() => {
      const dir = mkdtempSync(join(tmpdir(), "opentake-proc-test-"));
      const file = join(dir, "a.webm");
      execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-af", "volume=4", "-c:a", "libopus", file]);
      media = readFileSync(file);
    });

    const split = (data: Buffer, n: number) => {
      const size = Math.ceil(data.length / n);
      return Array.from({ length: n }, (_, i) => data.subarray(i * size, (i + 1) * size));
    };
    const runner = (maxAttempts = 3) => new JobRunner(t.db, storage, { ffmpeg, ffprobe, maxAttempts });

    it("turns uploaded chunks into a downloadable WAV and combined video", async () => {
      await uploadTrack(split(media, 3));
      t.tick(2000);
      await stop();
      await runner().drain();

      expect(await processing()).toBe("ready");
      const { recordings } = (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body;
      const outputs = recordings[0].outputs;
      expect(outputs.map((o: { fileName: string }) => o.fileName)).toEqual(["Combined.mp4", "Guest - audio.wav"]);
      expect(outputs[1].durationMs).toBe(2000);

      // The WAV really is in storage...
      const [row] = await t.db.query<{ storage_key: string }>("SELECT storage_key FROM outputs WHERE file_name = 'Guest - audio.wav'");
      expect(storage.objects.get(row!.storage_key)!.data.subarray(0, 4).toString()).toBe("RIFF");
      // ...and downloads go through a signed URL that names the file.
      const dl = await t.hostBrowser.get(`/studios/${t.studio.id}/recordings/${t.recordingId}/outputs/${outputs[1].id}`);
      expect(dl.status).toBe(302);
      expect(dl.headers.get("location")).toContain(`download=${encodeURIComponent("Guest - audio.wav")}`);
      expect(await jobs()).toEqual([{ status: "done" }]);
    });

    it("replaces the files when a recording is processed again", async () => {
      await uploadTrack(split(media, 2));
      t.tick(2000);
      await stop();
      await runner().drain();
      await t.hostBrowser.post(`/studios/${t.studio.id}/recordings/${t.recordingId}/process`);
      await runner().drain();
      expect(await t.db.query("SELECT id FROM outputs WHERE recording_id = $1", [t.recordingId])).toHaveLength(2);
    });

    it("marks the recording failed with a reason when the media is broken", async () => {
      await uploadTrack([Buffer.from("this is not a webm file")]);
      t.tick(2000);
      await stop();
      await runner(1).drain();

      expect(await processing()).toBe("failed");
      const { recordings } = (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body;
      expect(recordings[0].processingError).toMatch(/Processing failed/);
      const [job] = await t.db.query<{ status: string; error: string }>("SELECT status, error FROM jobs");
      expect(job).toMatchObject({ status: "failed", error: expect.stringMatching(/ffmpeg exited/) });
    });

    it("retries a failed job later instead of giving up at once", async () => {
      await uploadTrack([Buffer.from("broken")]);
      await stop();
      await runner(3).drain();
      expect(await processing()).toBe("queued");
      const [job] = await t.db.query<{ status: string; attempts: number }>("SELECT status, attempts FROM jobs");
      expect(job).toEqual({ status: "queued", attempts: 1 });
    });
  });
});
