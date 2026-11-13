// Mask tracks (background blur): a small video of where the person is, uploaded like any track.
// It may only ever help: it is never a file or a recording of a person, never counted, never
// waited for long, and a missing one costs the blur, not anyone's files.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkStorageKey, NO_FILTERS, type TrackFilters } from "@tapry/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { JobRunner } from "../src/server/jobs";
import { MAX_TRACKS_PER_PERSON } from "../src/server/uploads";
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

const AUDIO = "audio/webm;codecs=opus";
const VIDEO = "video/webm;codecs=vp8";
const BLUR: TrackFilters = { ...NO_FILTERS, background: "blur" };
type Kind = "audio" | "video" | "mask";

describe("mask tracks", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let storage: FakeStorage;

  beforeEach(async () => {
    storage = new FakeStorage();
    t = await setup(storage);
  });

  const mime = (kind: Kind) => (kind === "audio" ? AUDIO : VIDEO);
  const createTrack = (kind: Kind, opts: { token?: string; filters?: TrackFilters; mimeType?: string } = {}) =>
    t.call(
      `/sessions/${t.sessionId}/tracks`,
      { recordingId: t.recordingId, kind, mimeType: opts.mimeType ?? mime(kind), startedAt: t.now(), filters: opts.filters },
      opts.token ?? t.guest.token,
    );
  const complete = (trackId: string, lastSeq: number | null = 0, token = t.guest.token) =>
    t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq }, token);
  /** Register a track and upload `data` as its one chunk; finished unless `complete: false`. */
  async function upload(kind: Kind, data: Buffer, opts: { token?: string; filters?: TrackFilters; complete?: boolean } = {}) {
    const token = opts.token ?? t.guest.token;
    const { trackId } = (await createTrack(kind, opts)).body;
    const meta = { bytes: data.length, sha256: sha256(data) };
    await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/upload-url`, { ...meta, mimeType: mime(kind) }, token);
    storage.put(chunkStorageKey(t.sessionId, trackId, 0), data);
    await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/commit`, { ...meta, startTs: t.now(), endTs: t.now() + 2000 }, token);
    if (opts.complete !== false) await complete(trackId, 0, token);
    return trackId as string;
  }
  const stop = () => t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
  const summary = async () => (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body.recordings[0];
  const processJobs = () =>
    t.db.query<{ status: string; waiting: boolean }>(
      "SELECT status, run_after > now() AS waiting FROM jobs WHERE recording_id = $1 AND type = 'process_recording' ORDER BY created_at",
      [t.recordingId],
    );
  const bytes = (n: number) => Buffer.alloc(n, 7);

  describe("uploading one", () => {
    it("is a track like any other, kept as kind mask, and must be a video", async () => {
      const res = await createTrack("mask");
      expect(res.status).toBe(201);
      expect(await t.db.query("SELECT kind, participant_id FROM tracks WHERE id = $1", [res.body.trackId])).toEqual([
        { kind: "mask", participant_id: t.guest.participantId },
      ]);
      expect(await createTrack("mask", { mimeType: AUDIO })).toMatchObject({ status: 400, body: { error: "invalid_mask" } });
      expect((await createTrack("depth" as Kind)).status).toBe(400);
      expect((await createTrack("mask", { token: "nobody" })).status).toBe(401);
    });

    it("counts toward a person's track limit and their byte allowance", async () => {
      for (let i = 0; i < MAX_TRACKS_PER_PERSON; i++) expect((await createTrack("mask")).status).toBe(201);
      expect(await createTrack("audio")).toMatchObject({ status: 429, body: { error: "too_many_tracks" } });
      expect(await createTrack("mask")).toMatchObject({ status: 429, body: { error: "too_many_tracks" } });

      const small = await setup(new FakeStorage(), { bytesPerSecondCap: 1 }); // 600 bytes of slack in all
      const call = (path: string, body: unknown) => small.call(`/sessions/${small.sessionId}${path}`, body);
      const { trackId } = (await call("/tracks", { recordingId: small.recordingId, kind: "mask", mimeType: VIDEO, startedAt: small.now() })).body;
      const big = { bytes: 5000, sha256: sha256(bytes(5000)), mimeType: VIDEO };
      expect(await call(`/tracks/${trackId}/chunks/0/upload-url`, big)).toMatchObject({ status: 413, body: { error: "upload_quota" } });
    });

    it("stops taking uploads with its recording, like any track", async () => {
      const { trackId } = (await createTrack("mask")).body;
      await stop();
      await t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`);
      expect((await complete(trackId)).status).toBe(410);
      expect((await createTrack("mask")).status).toBe(410);
    });
  });

  describe("is never a person's recording", () => {
    it("isn't counted in tracks, people or upload progress, though it takes space", async () => {
      await upload("audio", bytes(10), { complete: false });
      await upload("mask", bytes(1000), { complete: false });
      const r = await summary();
      expect(r).toMatchObject({ tracks: 1, incompleteTracks: 1, bytes: 1010 });
      expect(r.people).toEqual([expect.objectContaining({ name: "Guest", tracks: 1, completeTracks: 0, bytes: 10 })]);
      const state = (await t.client({ token: t.host.token }).get(`/sessions/${t.sessionId}/state`)).body;
      expect(state.uploads).toEqual([{ participantId: t.guest.participantId, tracks: 1, completeTracks: 0, bytes: 10 }]);
      const storagePage = (await t.hostBrowser.get("/storage")).body;
      expect(storagePage.pieces).toEqual({ confirmed: 1, missing: 0 });
    });

    it("doesn't make someone a person of the recording: a mask alone is in no list, record or end screen", async () => {
      await upload("audio", bytes(10), { token: t.host.token });
      await upload("mask", bytes(1000)); // the guest: a mask and nothing else
      await stop();
      const r = await summary();
      expect(r.people.map((p: { name: string }) => p.name)).toEqual(["Host"]);
      expect((await t.hostBrowser.get("/guests")).body.guests).toEqual([]);
      expect((await t.hostBrowser.get("/dashboard/studios")).body.studios[0].people).toEqual(["Host"]);
      const consent = await t.services.processing.consentRecord(await owner(), t.studio.id, t.recordingId);
      expect(consent.body).toContain("Host (host)");
      expect(consent.body).not.toContain("Guest");
      const own = (await t.client({ token: t.guest.token }).get(`/sessions/${t.sessionId}/my-recordings`)).body;
      expect(own.recordings).toEqual([]);
    });
  });

  const owner = async () => {
    const [u] = await t.db.query<{ id: string; email: string; name: string; is_admin: boolean }>("SELECT id, email, name, is_admin FROM users");
    return { id: u!.id, email: u!.email, name: u!.name, isAdmin: u!.is_admin, emailVerified: true, accountId: u!.id };
  };

  describe("when processing starts", () => {
    it("is decided by the sound and camera tracks: a mask on its own starts nothing", async () => {
      await upload("mask", bytes(100));
      await stop();
      expect((await summary()).processing).toBe("pending");
      expect(await processJobs()).toEqual([]);
    });

    it("waits a moment for a mask that is still uploading, and goes as soon as it lands", async () => {
      await upload("video", bytes(100), { filters: BLUR });
      const mask = await upload("mask", bytes(100), { complete: false });
      await stop();
      // Everyone's recording is in: that is what the timeline says, and the job is queued, a few seconds off.
      const r = await summary();
      expect(r).toMatchObject({ processing: "queued", incompleteTracks: 0 });
      expect(r.uploadedAt).toEqual(expect.any(Number));
      expect(await processJobs()).toEqual([{ status: "queued", waiting: true }]);

      await complete(mask);
      expect(await processJobs()).toEqual([{ status: "queued", waiting: false }]);
    });

    it("doesn't wait at all when no mask is on its way, or when the host says go", async () => {
      await upload("video", bytes(100), { filters: BLUR });
      await upload("mask", bytes(100));
      await stop();
      expect(await processJobs()).toEqual([{ status: "queued", waiting: false }]);

      const other = await setup(storage);
      t = other;
      await upload("video", bytes(100), { filters: BLUR });
      await upload("mask", bytes(100), { complete: false });
      await stop();
      expect(await processJobs()).toEqual([{ status: "queued", waiting: true }]);
      expect((await t.hostBrowser.post(`/studios/${t.studio.id}/recordings/${t.recordingId}/process`)).status).toBe(202);
      expect(await processJobs()).toEqual([{ status: "queued", waiting: false }]);
    });

    it("makes the files again when a mask arrives after they were made", async () => {
      await upload("video", bytes(100), { filters: BLUR });
      const mask = await upload("mask", bytes(100), { complete: false });
      await stop();
      // The wait ran out and the files were made without it.
      await t.db.query("UPDATE jobs SET status = 'done', finished_at = now() WHERE recording_id = $1", [t.recordingId]);
      await t.db.query("UPDATE recordings SET processing = 'ready' WHERE id = $1", [t.recordingId]);
      await complete(mask);
      expect((await summary()).processing).toBe("queued");
      expect((await processJobs()).filter((j) => j.status === "queued")).toEqual([{ status: "queued", waiting: false }]);
    });

    it("asks a running job to go again when the mask lands meanwhile", async () => {
      await upload("video", bytes(100), { filters: BLUR });
      const mask = await upload("mask", bytes(100), { complete: false });
      await stop();
      await t.db.query("UPDATE jobs SET status = 'running', locked_until = now() + interval '5 minutes' WHERE recording_id = $1", [t.recordingId]);
      await complete(mask);
      expect(await t.db.query("SELECT rerun_requested FROM recordings WHERE id = $1", [t.recordingId])).toEqual([{ rerun_requested: true }]);
    });
  });

  describe("deleting", () => {
    it("removes a recording's mask chunks with everything else", async () => {
      await upload("audio", bytes(10));
      const mask = await upload("mask", bytes(1000));
      const key = chunkStorageKey(t.sessionId, mask, 0);
      expect(storage.objects.has(key)).toBe(true);
      await stop();
      expect((await t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`)).status).toBe(204);
      expect(await t.db.query("SELECT 1 FROM chunks WHERE track_id = $1", [mask])).toEqual([]);
      await new JobRunner(t.db, storage, { ffmpeg: "ffmpeg", ffprobe: "ffprobe" }).drain();
      expect(storage.objects.has(key)).toBe(false);
      expect([...storage.objects.keys()].filter((k) => k.startsWith(`recordings/${t.sessionId}/`))).toEqual([]);
    });

    it("removes them with the originals after the retention period, and an unfinished mask doesn't keep the originals", async () => {
      await upload("audio", bytes(10));
      const mask = await upload("mask", bytes(1000), { complete: false });
      await stop();
      await t.db.query("DELETE FROM jobs");
      await t.db.query("UPDATE recordings SET processing = 'ready' WHERE id = $1", [t.recordingId]);
      await t.db.query("INSERT INTO jobs (id, type, recording_id) VALUES ('job_raw', 'purge_raw', $1)", [t.recordingId]);
      await new JobRunner(t.db, storage, { ffmpeg: "ffmpeg", ffprobe: "ffprobe", rawRetentionMs: 1 }).drain();
      expect((await summary()).rawDeleted).toBe(true);
      expect(storage.objects.has(chunkStorageKey(t.sessionId, mask, 0))).toBe(false);
    });
  });

  // Each of these renders two people with ffmpeg, several times: over 20 s on a slow CI machine.
  const RENDER_TIMEOUT = 120_000;

  describe.skipIf(!hasFfmpeg)("in the files (with ffmpeg)", () => {
    let cam: Buffer;
    let maskVideo: Buffer;
    let dir: string;

    // A grainy camera picture (fine detail everywhere) and a mask that is white on the left half.
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "tapry-masks-test-"));
      const make = (name: string, source: string, rate: string) => {
        const file = join(dir, name);
        execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", source, "-c:v", "libvpx", "-deadline", "realtime", "-b:v", rate, "-an", file]);
        return readFileSync(file);
      };
      cam = make("cam.webm", "testsrc2=size=320x180:rate=24:duration=2,noise=alls=40:allf=t", "1500k");
      maskVideo = make("mask.webm", "color=black:s=256x144:r=15:d=2,format=gray,geq=lum='255*lt(X,128)'", "200k");
    });

    const runner = () => new JobRunner(t.db, storage, { ffmpeg, ffprobe });
    /** Fine detail (mean edge strength) in the right half of a stored video, one second in. */
    async function detailOnTheRight(fileName: string) {
      const [row] = await t.db.query<{ storage_key: string }>("SELECT storage_key FROM outputs WHERE recording_id = $1 AND file_name = $2", [t.recordingId, fileName]);
      const file = join(dir, `${Math.random().toString(36).slice(2)}.mp4`);
      writeFileSync(file, storage.objects.get(row!.storage_key)!.data);
      const out = execFileSync(ffmpeg, ["-v", "error", "-ss", "1", "-i", file, "-frames:v", "1",
        "-vf", "crop=iw/2-80:ih:iw/2+80:0,sobel,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]).toString();
      return Number.parseFloat(out.match(/YAVG=([\d.]+)/)![1]!);
    }
    const fileNames = async () => (await summary()).outputs.map((o: { fileName: string }) => o.fileName);

    it("blurs the background of the person who asked, by their own mask and nobody else's, and the mask is no file", async () => {
      await upload("video", cam, { filters: BLUR });
      await upload("mask", maskVideo);
      // The host asked for the blur too, but their device sent no mask: the guest's is not theirs to use.
      await upload("video", cam, { token: t.host.token, filters: BLUR });
      t.tick(2000);
      await stop();
      await runner().drain();

      const r = await summary();
      expect(r).toMatchObject({ processing: "ready", skippedTracks: [], tracks: 2, filtersFailed: [{ name: "Host", kind: "video" }] });
      expect(await fileNames()).toEqual(["Combined.mp4", "Host - video.mp4", "Guest - video.mp4"]);
      expect(await detailOnTheRight("Host - video.mp4")).toBeGreaterThan(10);
      expect(await detailOnTheRight("Guest - video.mp4")).toBeLessThan(3);

      // Not in the zip, not among the guest's own files.
      const zip = await t.services.processing.zipContents(await owner(), t.studio.id, t.recordingId);
      expect(zip.files.map((f) => f.name)).toEqual(["Combined.mp4", "Host - video.mp4", "Guest - video.mp4"]);
      const own = (await t.client({ token: t.guest.token }).get(`/sessions/${t.sessionId}/my-recordings`)).body;
      expect(own.recordings[0].files.map((f: { fileName: string }) => f.fileName)).toEqual(["Guest - video.mp4"]);

      // Without filters the mask isn't used, and nothing is reported as failed.
      await t.hostBrowser.post(`/studios/${t.studio.id}/recordings/${t.recordingId}/process`, { filters: false });
      await runner().drain();
      expect(await summary()).toMatchObject({ processing: "ready", filtersFailed: [] });
      expect(await detailOnTheRight("Guest - video.mp4")).toBeGreaterThan(10);
    }, RENDER_TIMEOUT);

    it("makes everyone's files without a mask that didn't arrive, says the blur is missing, and adds it when the mask comes", async () => {
      await upload("video", cam, { filters: BLUR });
      const mask = await upload("mask", maskVideo, { complete: false });
      t.tick(2000);
      await stop();
      // Still waiting for the mask: a worker has nothing to do yet.
      await runner().drain();
      expect((await summary()).processing).toBe("queued");
      // The wait is over.
      await t.db.query("UPDATE jobs SET run_after = now() WHERE recording_id = $1", [t.recordingId]);
      await runner().drain();
      expect(await summary()).toMatchObject({ processing: "ready", skippedTracks: [], filtersFailed: [{ name: "Guest", kind: "video" }] });
      expect(await detailOnTheRight("Guest - video.mp4")).toBeGreaterThan(10);

      await complete(mask);
      expect((await summary()).processing).toBe("queued");
      await runner().drain();
      expect(await summary()).toMatchObject({ processing: "ready", filtersFailed: [] });
      expect(await detailOnTheRight("Guest - video.mp4")).toBeLessThan(3);
    }, RENDER_TIMEOUT);

    it("never fails anyone's files over a mask that is rubbish or missing a piece", async () => {
      await upload("video", cam, { filters: BLUR });
      await upload("mask", Buffer.from("not a video at all"));
      // The host's mask lost its middle chunk.
      await upload("video", cam, { token: t.host.token, filters: BLUR });
      const { trackId } = (await createTrack("mask", { token: t.host.token })).body;
      for (const seq of [0, 2]) {
        const part = maskVideo.subarray(seq * 1000, (seq + 1) * 1000);
        const meta = { bytes: part.length, sha256: sha256(part) };
        await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/upload-url`, { ...meta, mimeType: VIDEO }, t.host.token);
        storage.put(chunkStorageKey(t.sessionId, trackId, seq), part);
        await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/commit`, { ...meta, startTs: t.now(), endTs: t.now() + 1 }, t.host.token);
      }
      await complete(trackId, 2, t.host.token);
      t.tick(2000);
      await stop();
      await runner().drain();
      const r = await summary();
      expect(r).toMatchObject({ processing: "ready", skippedTracks: [] });
      expect(r.filtersFailed).toEqual(expect.arrayContaining([{ name: "Guest", kind: "video" }, { name: "Host", kind: "video" }]));
      expect(await fileNames()).toEqual(["Combined.mp4", "Host - video.mp4", "Guest - video.mp4"]);
    }, RENDER_TIMEOUT);
  });
});
