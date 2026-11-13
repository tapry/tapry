import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkStorageKey, NO_FILTERS, type TrackFilters } from "@tapry/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { describeFilterFailures } from "../src/components/recording-filters";
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
const WARM: TrackFilters = { ...NO_FILTERS, brightness: 1, look: "warm", touchUp: true };
const QUIET: TrackFilters = { ...NO_FILTERS, noiseRemoval: true };

describe("filters", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let storage: FakeStorage;

  beforeEach(async () => {
    storage = new FakeStorage();
    t = await setup(storage);
  });

  const stored = async (trackId: string) =>
    (await t.db.query<{ filters: TrackFilters | null }>("SELECT filters FROM tracks WHERE id = $1", [trackId]))[0]!.filters;
  const createTrack = async (opts: { token?: string; kind?: "audio" | "video"; filters?: unknown; trackId?: string; recordingId?: string } = {}) =>
    t.call(
      `/sessions/${t.sessionId}/tracks`,
      { trackId: opts.trackId, recordingId: opts.recordingId ?? t.recordingId, kind: opts.kind ?? "audio", mimeType: MIME, startedAt: t.now(), filters: opts.filters },
      opts.token ?? t.guest.token,
    );
  const setFilters = (filters: unknown, token: string | null = t.guest.token, sessionId = t.sessionId) =>
    t.client().request("PUT", `/sessions/${sessionId}/filters`, { filters }, { token });
  const stop = (recordingId = t.recordingId) => t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${recordingId}/stop`);
  const summary = async () => (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body.recordings[0];
  const reprocess = (body?: unknown) => t.hostBrowser.request("POST", `/studios/${t.studio.id}/recordings/${t.recordingId}/process`, body);

  describe("on a track", () => {
    it("keeps the filters a track is registered with; none is the default", async () => {
      const withFilters = (await createTrack({ kind: "video", filters: WARM })).body.trackId;
      const without = (await createTrack()).body.trackId;
      const allOff = (await createTrack({ filters: NO_FILTERS })).body.trackId;
      expect(await stored(withFilters)).toEqual(WARM);
      expect(await stored(without)).toBeNull();
      expect(await stored(allOff)).toBeNull(); // nothing switched on is the same as none
    });

    it("fills in what a client leaves out, and refuses what isn't a filter", async () => {
      const partial = (await createTrack({ filters: { look: "mono" } })).body.trackId;
      expect(await stored(partial)).toEqual({ ...NO_FILTERS, look: "mono" });
      for (const bad of [{ look: "sepia" }, { brightness: 3 }, { touchUp: "yes" }, "warm"]) {
        const res = await createTrack({ filters: bad });
        expect(res, JSON.stringify(bad)).toMatchObject({ status: 400, body: { error: "invalid_body" } });
      }
    });

    it("doesn't wipe or change them when the same registration is sent again", async () => {
      const trackId = "trk_filters_retry_0001";
      expect((await createTrack({ trackId, filters: WARM })).status).toBe(201);
      // The retry of a recorder that has since lost its filters, and one that changed them.
      expect((await createTrack({ trackId })).status).toBe(201);
      expect((await createTrack({ trackId, filters: QUIET })).status).toBe(201);
      expect(await stored(trackId)).toEqual(WARM);
    });
  });

  describe("changing them during a session", () => {
    it("sets them on all of the person's own tracks in the running recording, and answers with what is kept", async () => {
      const audio = (await createTrack()).body.trackId;
      const video = (await createTrack({ kind: "video", filters: WARM })).body.trackId;
      const res = await setFilters({ look: "cool", noiseRemoval: true });
      expect(res.status).toBe(200);
      const kept = { ...NO_FILTERS, look: "cool", noiseRemoval: true };
      expect(res.body).toEqual({ filters: kept });
      // The whole choice on each: the camera track's sound takes noise removal too.
      expect(await stored(audio)).toEqual(kept);
      expect(await stored(video)).toEqual(kept);

      // Everything off again: back to none.
      expect((await setFilters(NO_FILTERS)).body).toEqual({ filters: NO_FILTERS });
      expect(await stored(audio)).toBeNull();
      expect(await stored(video)).toBeNull();
    });

    it("never touches anyone else's tracks: another person's token changes only their own", async () => {
      const mine = (await createTrack({ filters: WARM })).body.trackId;
      const hosts = (await createTrack({ token: t.host.token })).body.trackId;
      expect((await setFilters(QUIET, t.host.token)).status).toBe(200);
      expect(await stored(mine)).toEqual(WARM);
      expect(await stored(hosts)).toEqual(QUIET);
    });

    it("leaves recordings that have stopped as they were", async () => {
      const first = (await createTrack({ filters: WARM })).body.trackId;
      await stop();
      const second = (await t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings`)).body.recording.id;
      const next = (await createTrack({ recordingId: second })).body.trackId;
      expect((await setFilters(QUIET)).status).toBe(200);
      expect(await stored(first)).toEqual(WARM);
      expect(await stored(next)).toEqual(QUIET);

      // With nothing running there is nothing to change, and nothing to refuse either.
      await stop(second);
      expect(await setFilters(WARM)).toMatchObject({ status: 200, body: { filters: WARM } });
      expect(await stored(next)).toEqual(QUIET);
    });

    it("is never refused for a deleted recording (410 would make a recorder drop its copy)", async () => {
      await createTrack({ filters: WARM });
      await stop();
      await t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`);
      expect((await setFilters(QUIET)).status).toBe(200);
    });

    it("needs the person's own token for this session, and real filters", async () => {
      expect((await setFilters(WARM, null)).status).toBe(401);
      expect((await setFilters(WARM, "not-a-token")).status).toBe(401);
      expect((await setFilters(WARM, t.guest.token, "ses_someone_elses")).status).toBe(403);
      for (const bad of [{ look: "sepia" }, { brightness: -1 }, { noiseRemoval: 1 }, null]) {
        expect(await setFilters(bad), JSON.stringify(bad)).toMatchObject({ status: 400, body: { error: "invalid_body" } });
      }
      expect((await t.client().request("PUT", `/sessions/${t.sessionId}/filters`, {}, { token: t.guest.token })).status).toBe(400);
      expect((await t.client().request("PUT", `/sessions/${t.sessionId}/filters`, "{", { token: t.guest.token })).status).toBe(400);
    });
  });

  describe("processing with or without them", () => {
    it("tells the host whether anyone chose filters and whether the files have them", async () => {
      await createTrack();
      expect(await summary()).toMatchObject({ hasFilters: false, applyFilters: true });
      await setFilters(WARM);
      expect(await summary()).toMatchObject({ hasFilters: true, applyFilters: true });
      const one = (await t.hostBrowser.get(`/recordings/${t.recordingId}`)).body;
      expect(one).toMatchObject({ hasFilters: true, applyFilters: true });
    });

    it("processes again without filters, or with them, when the host asks", async () => {
      const trackId = (await createTrack({ filters: WARM })).body.trackId;
      await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq: null });
      await stop();
      const jobs = () => t.db.query("SELECT id FROM jobs WHERE recording_id = $1 AND type = 'process_recording' AND status = 'queued'", [t.recordingId]);
      await t.db.query("DELETE FROM jobs");

      expect(await reprocess({ filters: false })).toMatchObject({ status: 202, body: { queued: true } });
      expect(await summary()).toMatchObject({ hasFilters: true, applyFilters: false, processing: "queued" });
      expect(await jobs()).toHaveLength(1);
      // The choice stays until it is changed: a plain "process again" keeps it.
      expect((await reprocess()).status).toBe(202);
      expect((await reprocess({})).status).toBe(202);
      expect((await summary()).applyFilters).toBe(false);
      expect((await reprocess({ filters: true })).status).toBe(202);
      expect((await summary()).applyFilters).toBe(true);
      expect(await stored(trackId)).toEqual(WARM); // what the person chose is never lost
      expect(await jobs()).toHaveLength(1);

      expect(await reprocess({ filters: "no" })).toMatchObject({ status: 400, body: { error: "invalid_body" } });
      expect(await reprocess("{")).toMatchObject({ status: 400, body: { error: "invalid_json" } });
    });

    it("refuses as before while recording, and once the originals are gone", async () => {
      expect(await reprocess({ filters: false })).toMatchObject({ status: 409, body: { error: "still_recording" } });
      await stop();
      await t.db.query("UPDATE recordings SET raw_deleted_at = now() WHERE id = $1", [t.recordingId]);
      expect(await reprocess({ filters: false })).toMatchObject({ status: 409, body: { error: "originals_removed" } });
      expect((await summary()).applyFilters).toBe(true); // refused: nothing changed
    });
  });

  describe("when they couldn't be applied", () => {
    it("starts empty, and names each person once with their files", async () => {
      await createTrack({ filters: WARM });
      expect((await summary()).filtersFailed).toEqual([]);
      expect(describeFilterFailures([{ name: "Sam Guest", kind: "video" }])).toBe("Sam Guest's video");
      expect(describeFilterFailures([{ name: "Sam", kind: "audio" }, { name: "Sam", kind: "video" }])).toBe("Sam's video and audio");
      expect(describeFilterFailures([{ name: "Sam", kind: "video" }, { name: "Bo", kind: "audio" }])).toBe("Sam's video and Bo's audio");
      expect(describeFilterFailures([{ name: "Sam", kind: "audio" }, { name: "Sam", kind: "video" }, { name: "Bo", kind: "audio" }])).toBe(
        "Sam's video and audio, and Bo's audio",
      );
      expect(describeFilterFailures([{ name: "A", kind: "video" }, { name: "B", kind: "video" }, { name: "C", kind: "audio" }])).toBe(
        "A's video, B's video, and C's audio",
      );
    });
  });

  describe.skipIf(!hasFfmpeg)("in the files (with ffmpeg)", () => {
    let media: Buffer;

    beforeEach(() => {
      const dir = mkdtempSync(join(tmpdir(), "tapry-filters-test-"));
      const file = join(dir, "a.webm");
      execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.008:duration=2:seed=3",
        "-filter_complex", "[0:a]volume=4[t];[t][1:a]amix=inputs=2:normalize=0[a]", "-map", "[a]", "-c:a", "libopus", file]);
      media = readFileSync(file);
    });

    async function upload(token: string, filters?: TrackFilters) {
      const { trackId } = (await createTrack({ token, filters })).body;
      const meta = { bytes: media.length, sha256: sha256(media) };
      await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/upload-url`, { ...meta, mimeType: MIME }, token);
      storage.put(chunkStorageKey(t.sessionId, trackId, 0), media);
      await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/commit`, { ...meta, startTs: t.now(), endTs: t.now() + 1 }, token);
      await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq: 0 }, token);
      return trackId as string;
    }
    const runner = () => new JobRunner(t.db, storage, { ffmpeg, ffprobe });
    const fileNames = async () => (await summary()).outputs.map((o: { fileName: string }) => o.fileName);

    it("applies a person's filters to their files, keeps their sound as recorded next to the cleaned one, and leaves them out when asked", async () => {
      await upload(t.guest.token, QUIET);
      await upload(t.host.token);
      t.tick(2000);
      await stop();
      await runner().drain();
      expect(await summary()).toMatchObject({ processing: "ready", hasFilters: true, applyFilters: true });
      // The cleaned file first, the one as recorded after it; the host chose nothing and has one file.
      expect(await fileNames()).toEqual(["Combined.wav", "Host - audio.wav", "Guest - audio.wav", "Guest - audio (original).wav"]);
      const rows = await t.db.query<{ file_name: string; kind: string; participant_id: string; duration_ms: number }>(
        "SELECT file_name, kind, participant_id, duration_ms FROM outputs WHERE file_name LIKE 'Guest%' ORDER BY file_name DESC",
      );
      expect(rows).toEqual([
        { file_name: "Guest - audio.wav", kind: "audio", participant_id: t.guest.participantId, duration_ms: 2000 },
        { file_name: "Guest - audio (original).wav", kind: "audio", participant_id: t.guest.participantId, duration_ms: 2000 },
      ]);

      // The guest's end screen offers both, theirs only, the cleaned one first.
      const own = (await t.client({ token: t.guest.token }).get(`/sessions/${t.sessionId}/my-recordings`)).body;
      expect(own.recordings[0].files.map((f: { fileName: string }) => f.fileName)).toEqual(["Guest - audio.wav", "Guest - audio (original).wav"]);
      // And the zip has both.
      const zip = await t.services.processing.zipContents(
        (await t.db.query<{ id: string; email: string; name: string; is_admin: boolean }>("SELECT id, email, name, is_admin FROM users"))
          .map((u) => ({ id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin, emailVerified: true, accountId: u.id }))[0]!,
        t.studio.id,
        t.recordingId,
      );
      expect(zip.files.map((f) => f.name)).toEqual(["Combined.wav", "Host - audio.wav", "Guest - audio.wav", "Guest - audio (original).wav"]);

      // Without filters: the runner passes none, so the files are as recorded and there is no second one.
      expect((await reprocess({ filters: false })).status).toBe(202);
      await runner().drain();
      expect(await summary()).toMatchObject({ processing: "ready", hasFilters: true, applyFilters: false });
      expect(await fileNames()).toEqual(["Combined.wav", "Host - audio.wav", "Guest - audio.wav"]);
      // Nothing of the filtered run is left in storage.
      expect([...storage.objects.keys()].filter((k) => k.startsWith(`outputs/${t.sessionId}/`))).toHaveLength(3);

      // And back.
      expect((await reprocess({ filters: true })).status).toBe(202);
      await runner().drain();
      expect(await fileNames()).toContain("Guest - audio (original).wav");
    });

    it("tells the host whose file is as recorded when a filter couldn't be run, and stops saying so after a run where it could", async () => {
      // An ffmpeg without the noise filter.
      const broken = join(mkdtempSync(join(tmpdir(), "tapry-filters-ffmpeg-")), "ffmpeg.sh");
      writeFileSync(broken, `#!/bin/sh\ncase "$*" in *afftdn*) echo "No such filter: 'afftdn'" >&2; exit 1;; esac\nexec "${ffmpeg}" "$@"\n`);
      chmodSync(broken, 0o755);
      await upload(t.guest.token, QUIET);
      await upload(t.host.token);
      t.tick(2000);
      await stop();
      await new JobRunner(t.db, storage, { ffmpeg: broken, ffprobe }).drain();

      // Everyone has their file; the guest's is as recorded, and the list says so (and nothing is "skipped").
      const failed = await summary();
      expect(failed).toMatchObject({ processing: "ready", applyFilters: true, skippedTracks: [], filtersFailed: [{ name: "Guest", kind: "audio" }] });
      expect(failed.outputs.map((o: { fileName: string }) => o.fileName)).toEqual(["Combined.wav", "Host - audio.wav", "Guest - audio.wav"]);
      expect((await t.hostBrowser.get(`/recordings/${t.recordingId}`)).body.filtersFailed).toEqual([{ name: "Guest", kind: "audio" }]);
      expect((await t.hostBrowser.get("/recordings")).body.recordings[0].filtersFailed).toEqual([{ name: "Guest", kind: "audio" }]);

      // A run that manages clears it.
      expect((await reprocess()).status).toBe(202);
      await runner().drain();
      expect(await summary()).toMatchObject({ processing: "ready", filtersFailed: [] });
      expect(await fileNames()).toContain("Guest - audio (original).wav");

      // So does a run without filters after a failed one: nothing was tried, so nothing failed.
      expect((await reprocess()).status).toBe(202);
      await new JobRunner(t.db, storage, { ffmpeg: broken, ffprobe }).drain();
      expect((await summary()).filtersFailed).toEqual([{ name: "Guest", kind: "audio" }]);
      expect((await reprocess({ filters: false })).status).toBe(202);
      await new JobRunner(t.db, storage, { ffmpeg: broken, ffprobe }).drain();
      expect(await summary()).toMatchObject({ applyFilters: false, filtersFailed: [] });
    });
  });
});
