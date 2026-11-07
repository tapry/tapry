import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkStorageKey } from "@tapry/shared";
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

  describe("job runner lifecycle (separate workers)", () => {
    /** A stand-in for ffmpeg that just takes its time, so a job stays running. */
    function slowFfmpeg(seconds: number) {
      const path = join(mkdtempSync(join(tmpdir(), "tapry-slow-")), "ffmpeg");
      writeFileSync(path, `#!/bin/sh\nsleep ${seconds}\nexit 1\n`);
      chmodSync(path, 0o755);
      return path;
    }
    const lockedUntil = async () =>
      new Date(
        (await t.db.query<{ locked_until: string }>("SELECT locked_until FROM jobs WHERE recording_id = $1", [t.recordingId]))[0]!
          .locked_until,
      ).getTime();
    const waitFor = async (check: () => Promise<boolean>) => {
      for (let i = 0; i < 100 && !(await check()); i++) await new Promise((r) => setTimeout(r, 50));
    };

    it("keeps renewing the lock while a job runs, so no other worker takes it", async () => {
      await uploadTrack([Buffer.from("a")]);
      await stop();
      const slow = slowFfmpeg(3);
      const runner = new JobRunner(t.db, storage, { ffmpeg: slow, ffprobe: slow, lockMs: 1500, maxAttempts: 1 });
      const running = runner.drain();
      await waitFor(async () => (await jobs())[0]?.status === "running");
      const first = await lockedUntil();
      await new Promise((r) => setTimeout(r, 1200));
      expect(await lockedUntil()).toBeGreaterThan(first); // renewed while still working

      // A second worker polling now finds nothing to claim.
      const other = new JobRunner(t.db, storage, { ffmpeg: slow, ffprobe: slow, lockMs: 1500 });
      const claimed = await (other as unknown as { claim(): Promise<unknown> }).claim();
      expect(claimed).toBeNull();
      await running;
    });

    it("hands a running job back to the queue on shutdown, without counting it as a failure", async () => {
      await uploadTrack([Buffer.from("a")]);
      await stop();
      const slow = slowFfmpeg(5);
      const runner = new JobRunner(t.db, storage, { ffmpeg: slow, ffprobe: slow });
      void runner.drain();
      await waitFor(async () => (await jobs())[0]?.status === "running");

      const released = await runner.shutdown();
      expect(released).toMatch(/^job_/);
      const [job] = await t.db.query<{ status: string; attempts: number; locked_until: unknown }>(
        "SELECT status, attempts, locked_until FROM jobs WHERE recording_id = $1",
        [t.recordingId],
      );
      expect(job).toEqual({ status: "queued", attempts: 0, locked_until: null });
      expect(await processing()).toBe("queued");

      // Another worker can claim it straight away.
      const next = new JobRunner(t.db, storage, { ffmpeg: slow, ffprobe: slow });
      expect(await (next as unknown as { claim(): Promise<{ id: string } | null> }).claim()).toMatchObject({ id: released });
    });

    it("has nothing to hand back when idle", async () => {
      const runner = new JobRunner(t.db, storage, { ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
      expect(await runner.shutdown()).toBeNull();
    });
  });

  describe.skipIf(!hasFfmpeg)("job runner with ffmpeg", () => {
    let media: Buffer;

    beforeEach(() => {
      const dir = mkdtempSync(join(tmpdir(), "tapry-proc-test-"));
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

    it("turns uploaded chunks into a downloadable WAV and, with no camera, a mixed WAV", async () => {
      await uploadTrack(split(media, 3));
      t.tick(2000);
      await stop();
      await runner().drain();

      expect(await processing()).toBe("ready");
      const { recordings } = (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body;
      // The timeline: every step has its time, in order, and no job is left half-way.
      const r = recordings[0];
      expect(r.uploadedAt).toEqual(expect.any(Number));
      expect(r.processingStartedAt).toBeGreaterThanOrEqual(r.uploadedAt);
      expect(r.processedAt).toBeGreaterThanOrEqual(r.processingStartedAt);
      expect(r.progress).toBeNull();
      const outputs = recordings[0].outputs;
      expect(outputs.map((o: { fileName: string }) => o.fileName)).toEqual(["Combined.wav", "Guest - audio.wav"]);
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
      const outputKeys = () => [...storage.objects.keys()].filter((k) => k.startsWith(`outputs/${t.sessionId}/`));
      const first = outputKeys();
      await t.hostBrowser.post(`/studios/${t.studio.id}/recordings/${t.recordingId}/process`);
      await runner().drain();
      expect(await t.db.query("SELECT id FROM outputs WHERE recording_id = $1", [t.recordingId])).toHaveLength(2);
      // The first run's files are gone from storage, not just from the list.
      expect(outputKeys()).toHaveLength(2);
      expect(outputKeys().filter((k) => first.includes(k))).toEqual([]);
    });

    it("schedules removing the originals only when RAW_RETENTION_DAYS is set", async () => {
      await uploadTrack(split(media, 2));
      t.tick(2000);
      await stop();
      await new JobRunner(t.db, storage, { ffmpeg, ffprobe, rawRetentionMs: 7 * 86_400_000 }).drain();
      expect(await processing()).toBe("ready");
      const [job] = await t.db.query<{ status: string; due_days: number }>(
        "SELECT status, extract(epoch FROM run_after - now()) / 86400 AS due_days FROM jobs WHERE recording_id = $1 AND type = 'purge_raw'",
        [t.recordingId],
      );
      expect(job!.status).toBe("queued");
      expect(Number(job!.due_days)).toBeGreaterThan(6.9);

      // Default (unset): processing again schedules nothing new and nothing is removed.
      await t.db.query("DELETE FROM jobs WHERE type = 'purge_raw'");
      await t.hostBrowser.post(`/studios/${t.studio.id}/recordings/${t.recordingId}/process`);
      await runner().drain();
      expect(await t.db.query("SELECT 1 FROM jobs WHERE type = 'purge_raw'")).toEqual([]);
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

    it("leaves a guest's unreadable upload out, gives everyone else their files, and tells the host", async () => {
      await uploadTrack(split(media, 3)); // the guest's: fine
      await uploadTrack([Buffer.from("not media".repeat(200))], { token: t.host.token }); // the host's: junk
      t.tick(2000);
      await stop();
      await runner().drain();
      expect(await processing()).toBe("ready");
      const { recordings } = (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body;
      expect(recordings[0].skippedTracks).toEqual([{ name: "Host", kind: "audio" }]);
      expect(recordings[0].outputs.map((o: { fileName: string }) => o.fileName)).toContain("Guest - audio.wav");
      // The guest still gets their own file.
      const { body } = await t.client({ token: t.guest.token }).get(`/sessions/${t.sessionId}/my-recordings`);
      expect(body.recordings[0].files).toHaveLength(1);
    });

    it("renders again when a late track finishes during a render, so nobody is silently missing", async () => {
      await uploadTrack(split(media, 3));
      t.tick(2000);
      await stop();
      expect(await processing()).toBe("queued");
      // While the job runs (it has marked itself started), the host's late track arrives.
      let late: Promise<unknown> | null = null;
      const r = new JobRunner(t.db, storage, {
        ffmpeg, ffprobe,
        onChange: () => {
          late ??= uploadTrack(split(media, 2), { token: t.host.token });
        },
      });
      await r.drain();
      await late;
      await r.drain();
      expect(await processing()).toBe("ready");
      const { recordings } = (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body;
      expect(recordings[0].outputs.map((o: { fileName: string }) => o.fileName)).toEqual(expect.arrayContaining(["Guest - audio.wav", "Host - audio.wav"]));
      const [{ rerun_requested }] = (await t.db.query<{ rerun_requested: boolean }>("SELECT rerun_requested FROM recordings WHERE id = $1", [t.recordingId])) as [{ rerun_requested: boolean }];
      expect(rerun_requested).toBe(false);
      expect(await jobs()).toEqual([{ status: "done" }, { status: "done" }]);
    });

    it("still renders a track with a lost middle chunk (where it lands: apps/worker/test/pipeline.test.ts)", async () => {
      const parts = split(media, 4);
      const trackId = await uploadTrack(parts);
      await t.db.query("DELETE FROM chunks WHERE track_id = $1 AND seq = 2", [trackId]);
      t.tick(2000);
      await stop();
      await runner().drain();
      expect(await processing()).toBe("ready");
    });

    const whisper = process.env.WHISPER_PATH;
    const model = process.env.WHISPER_MODEL;
    const canSay = (() => {
      try {
        execFileSync("say", ["-v", "?"], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })();

    it.skipIf(!whisper || !model || !canSay)("transcribes after processing, labelled by speaker", async () => {
      const dir = mkdtempSync(join(tmpdir(), "tapry-speech-"));
      execFileSync("say", ["-v", "Samantha", "-o", join(dir, "s.aiff"), "Thanks for having me on the show today."]);
      execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", join(dir, "s.aiff"), "-ar", "48000", "-c:a", "libopus", join(dir, "s.webm")]);
      await uploadTrack(split(readFileSync(join(dir, "s.webm")), 3));
      t.tick(4000);
      await stop();
      const r = new JobRunner(t.db, storage, { ffmpeg, ffprobe, whisper: { whisper: whisper!, model: model!, threads: 4 } });
      await r.drain(); // processing, then the transcript job it queues

      const [rec] = await t.db.query<{ processing: string; transcript: string }>(
        "SELECT processing, transcript FROM recordings WHERE id = $1",
        [t.recordingId],
      );
      expect(rec).toEqual({ processing: "ready", transcript: "ready" });
      const { recordings } = (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body;
      expect(recordings[0].transcript).toBe("ready");
      expect(recordings[0].outputs.map((o: { fileName: string }) => o.fileName)).toEqual([
        "Combined.wav",
        "Guest - audio.wav",
        "Transcript.docx",
        "Transcript.srt",
        "Transcript.txt",
        "Transcript.vtt",
      ]);
      // The Word file holds the same words (its parts are stored uncompressed, so they're readable here).
      const [docx] = await t.db.query<{ storage_key: string }>("SELECT storage_key FROM outputs WHERE file_name = 'Transcript.docx'");
      const word = storage.objects.get(docx!.storage_key)!.data;
      expect(word.subarray(0, 2).toString()).toBe("PK");
      expect(word.toString().toLowerCase()).toContain("thanks for having me");
      const [txt] = await t.db.query<{ storage_key: string }>("SELECT storage_key FROM outputs WHERE file_name = 'Transcript.txt'");
      const text = storage.objects.get(txt!.storage_key)!.data.toString();
      expect(text).toMatch(/^\[00:00:0\d\] Guest: /);
      expect(text.toLowerCase()).toContain("thanks for having me");
    });

    it("leaves transcripts off when no Whisper model is configured", async () => {
      await uploadTrack(split(media, 2));
      t.tick(2000);
      await stop();
      await runner().drain();
      const [rec] = await t.db.query<{ transcript: string }>("SELECT transcript FROM recordings WHERE id = $1", [t.recordingId]);
      expect(rec!.transcript).toBe("off");
      expect(await t.db.query("SELECT id FROM jobs WHERE type = 'transcribe_recording'")).toEqual([]);
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
