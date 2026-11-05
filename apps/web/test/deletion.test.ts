import { chunkStorageKey } from "@tapry/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { JobRunner } from "../src/server/jobs";
import { hashPassword } from "../src/server/passwords";
import { expectOk, FakeStorage, setup, sha256 } from "./harness";

const MIME = "audio/webm;codecs=opus";

describe("deleting recordings and studios", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let storage: FakeStorage;

  beforeEach(async () => {
    storage = new FakeStorage();
    t = await setup(storage);
  });

  const host = () => t.client({ token: t.host.token });
  const stop = (recordingId = t.recordingId) => expectOk(host().post(`/sessions/${t.sessionId}/recordings/${recordingId}/stop`));
  const recordingPath = (recordingId = t.recordingId) => `/studios/${t.studio.id}/recordings/${recordingId}`;
  const list = async () => (await expectOk(t.hostBrowser.get(`/studios/${t.studio.id}/recordings`))).body.recordings;
  const runner = (purgeRepeatMs = 60_000) => new JobRunner(t.db, storage, { ffmpeg: "ffmpeg", ffprobe: "ffprobe", purgeRepeatMs });
  const keysUnder = (prefix: string) => [...storage.objects.keys()].filter((k) => k.startsWith(prefix));

  /** Register a guest track and upload `parts` as its chunks, the way the recorder does. */
  async function uploadTrack(parts: string[], opts: { complete?: boolean; recordingId?: string } = {}) {
    const recordingId = opts.recordingId ?? t.recordingId;
    const { trackId } = (
      await expectOk(t.call(`/sessions/${t.sessionId}/tracks`, { recordingId, kind: "audio", mimeType: MIME, startedAt: t.now() }))
    ).body;
    for (const [seq, text] of parts.entries()) await uploadChunk(trackId, seq, text);
    if (opts.complete !== false) {
      await expectOk(t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq: parts.length - 1 }));
    }
    return trackId as string;
  }

  async function uploadChunk(trackId: string, seq: number, text: string) {
    const meta = { bytes: Buffer.byteLength(text), sha256: sha256(text) };
    const url = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/upload-url`, { ...meta, mimeType: MIME });
    if (url.status !== 200) return url;
    storage.put(chunkStorageKey(t.sessionId, trackId, seq), text);
    return t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/commit`, { ...meta, startTs: t.now(), endTs: t.now() + 1 });
  }

  /** Another host on the same server, signed in (sign-up is closed, so made directly). */
  async function otherHost() {
    await t.db.query("INSERT INTO users (id, email, name, password_hash) VALUES ('usr_other', 'other@example.com', 'Other', $1)", [
      await hashPassword("another good password"),
    ]);
    const browser = t.client();
    await expectOk(browser.post("/auth/login", { email: "other@example.com", password: "another good password" }));
    return browser;
  }

  /** A processed file, as the worker would leave it. */
  async function addOutput(recordingId: string, bytes: number) {
    const key = `outputs/${t.sessionId}/${recordingId}/out_${bytes}.wav`;
    storage.put(key, "x".repeat(bytes));
    await t.db.query(
      `INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes)
       VALUES ($1, $2, 'audio', 'Guest - audio.wav', 'audio/wav', $3, $4)`,
      [`out_${bytes}`, recordingId, key, bytes],
    );
    return key;
  }

  /** A second, finished recording in the same session, to check deletes stay inside their recording. */
  async function otherRecording() {
    const id: string = (await expectOk(host().post(`/sessions/${t.sessionId}/recordings`))).body.recording.id;
    const trackId = await uploadTrack(["keep me"], { recordingId: id });
    await stop(id);
    return { id, trackId };
  }

  describe("storage usage", () => {
    it("counts uploaded chunks and processed files, per recording and per studio", async () => {
      await uploadTrack(["abc", "defg"]); // 7 bytes
      await stop();
      await addOutput(t.recordingId, 100);

      const [rec] = await list();
      expect(rec.bytes).toBe(107);
      const { studios } = (await expectOk(t.hostBrowser.get("/studios"))).body;
      expect(studios).toEqual([expect.objectContaining({ id: t.studio.id, recordings: 1, bytes: 107 })]);
    });

    it("shows zero for a studio with nothing recorded", async () => {
      const other = (await expectOk(t.hostBrowser.post("/studios", { name: "Empty" }))).body;
      const { studios } = (await expectOk(t.hostBrowser.get("/studios"))).body;
      expect(studios.find((s: { id: string }) => s.id === other.id)).toMatchObject({ recordings: 0, bytes: 0 });
    });
  });

  describe("a recording", () => {
    it("disappears from the list and the usage at once, and its files are purged", async () => {
      const trackId = await uploadTrack(["abc", "defg"]);
      await stop();
      await addOutput(t.recordingId, 100);
      const other = await otherRecording();

      expect((await t.hostBrowser.del(recordingPath())).status).toBe(204);
      expect((await list()).map((r: { id: string }) => r.id)).toEqual([other.id]);
      const { studios } = (await expectOk(t.hostBrowser.get("/studios"))).body;
      expect(studios[0]).toMatchObject({ recordings: 1, bytes: 7 }); // "keep me"
      expect(await t.db.query("SELECT 1 FROM chunks WHERE track_id = $1", [trackId])).toEqual([]);

      // Files go when the purge job runs (the worker), and only this recording's.
      expect(keysUnder(`recordings/${t.sessionId}/${trackId}/`)).toHaveLength(2);
      await runner().drain();
      expect(keysUnder(`recordings/${t.sessionId}/${trackId}/`)).toEqual([]);
      expect(keysUnder(`outputs/${t.sessionId}/${t.recordingId}/`)).toEqual([]);
      expect(keysUnder(`recordings/${t.sessionId}/${other.trackId}/`)).toHaveLength(1);
    });

    it("purges again once old upload URLs have expired, catching a guest's PUT that landed after the delete", async () => {
      const trackId = await uploadTrack(["abc"], { complete: false });
      await stop();
      // The guest got an upload URL just before the delete; the PUT arrives just after.
      await expectOk(t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/1/upload-url`, { bytes: 3, sha256: sha256("xyz"), mimeType: MIME }));
      await expectOk(t.hostBrowser.del(recordingPath()));
      await runner(200).drain();
      storage.put(chunkStorageKey(t.sessionId, trackId, 1), "xyz");

      const purge = () => t.db.query<{ status: string }>("SELECT status FROM jobs WHERE recording_id = $1 AND type = 'purge_recording'", [t.recordingId]);
      expect(await purge()).toEqual([{ status: "queued" }]); // first pass done, comes back later
      await new Promise((r) => setTimeout(r, 250));
      await runner(200).drain();
      expect(keysUnder(`recordings/${t.sessionId}/${trackId}/`)).toEqual([]);
      expect(await purge()).toEqual([{ status: "done" }]);
    });

    it("tells a guest still uploading it that it is gone (410), for every upload call", async () => {
      const trackId = await uploadTrack(["abc"], { complete: false });
      await stop();
      await expectOk(t.hostBrowser.del(recordingPath()));

      const url = await uploadChunk(trackId, 1, "more");
      expect(url.status).toBe(410);
      expect(url.body.error).toBe("recording_deleted");
      const commit = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/commit`, { bytes: 3, sha256: sha256("abc"), startTs: 0, endTs: 1 });
      expect(commit.status).toBe(410);
      const complete = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq: 1 });
      expect(complete.status).toBe(410);
      // A guest who was offline throughout registers their track only now.
      const late = await t.call(`/sessions/${t.sessionId}/tracks`, { recordingId: t.recordingId, kind: "video", mimeType: MIME, startedAt: t.now() });
      expect(late.status).toBe(410);
    });

    it("is refused while it is still recording", async () => {
      const res = await t.hostBrowser.del(recordingPath());
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("still_recording");
      expect(await list()).toHaveLength(1);
    });

    it("is refused while a worker is processing it, and allowed once that worker's lock has lapsed", async () => {
      await uploadTrack(["abc"]);
      await stop(); // queues processing
      await t.db.query("UPDATE jobs SET status = 'running', locked_until = now() + interval '5 minutes' WHERE recording_id = $1", [t.recordingId]);
      const busy = await t.hostBrowser.del(recordingPath());
      expect(busy.status).toBe(409);
      expect(busy.body.error).toBe("processing_busy");
      expect(await list()).toHaveLength(1);

      await t.db.query("UPDATE jobs SET locked_until = now() - interval '1 second' WHERE recording_id = $1", [t.recordingId]);
      expect((await t.hostBrowser.del(recordingPath())).status).toBe(204);
    });

    it("cancels processing that hasn't started yet", async () => {
      await uploadTrack(["abc"]);
      await stop();
      await expectOk(t.hostBrowser.del(recordingPath()));
      const jobs = await t.db.query<{ type: string }>("SELECT type FROM jobs WHERE recording_id = $1", [t.recordingId]);
      expect(jobs).toEqual([{ type: "purge_recording" }]);
    });

    it("is idempotent, and 404 afterwards for everything else", async () => {
      await stop();
      expect((await t.hostBrowser.del(recordingPath())).status).toBe(204);
      expect((await t.hostBrowser.del(recordingPath())).status).toBe(404);
      expect((await t.hostBrowser.post(`${recordingPath()}/process`)).status).toBe(404);
    });

    it("keeps other hosts and other sites out", async () => {
      await stop();
      expect((await t.client().del(recordingPath())).status).toBe(401);
      expect((await (await otherHost()).del(recordingPath())).status).toBe(404);
      expect((await t.hostBrowser.del(recordingPath(), { origin: "https://evil.test" })).status).toBe(403);
      expect(await list()).toHaveLength(1);
    });

    it("no longer studios in the live session", async () => {
      await stop();
      await expectOk(t.hostBrowser.del(recordingPath()));
      const state = (await expectOk(host().get(`/sessions/${t.sessionId}/state`))).body;
      expect(state.recording).toBeNull();
    });
  });

  describe("a studio", () => {
    it("is refused while a recording runs, without deleting anything", async () => {
      const res = await t.hostBrowser.del(`/studios/${t.studio.id}`);
      expect(res.status).toBe(409);
      expect((await expectOk(t.hostBrowser.get("/studios"))).body.studios).toHaveLength(1);
    });

    it("goes with all its recordings; the session ends and the guest link stops working", async () => {
      const trackId = await uploadTrack(["abc"], { complete: false });
      await stop();
      const other = await otherRecording();

      expect((await t.hostBrowser.del(`/studios/${t.studio.id}`)).status).toBe(204);
      expect((await expectOk(t.hostBrowser.get("/studios"))).body.studios).toEqual([]);
      expect((await t.hostBrowser.get(`/studios/${t.studio.id}`)).status).toBe(404);
      expect((await t.hostBrowser.post(`/studios/${t.studio.id}/open`)).status).toBe(404);
      const join = await t.client().post("/join", { inviteCode: t.studio.inviteCode, displayName: "Late", consent: true });
      expect(join.status).toBe(404);
      const state = (await expectOk(host().get(`/sessions/${t.sessionId}/state`))).body;
      expect(state.session.status).toBe("ended");

      // A guest still uploading is told to stop; the worker removes every file.
      expect((await uploadChunk(trackId, 1, "more")).status).toBe(410);
      await runner().drain();
      expect(keysUnder(`recordings/${t.sessionId}/`)).toEqual([]);
      const purged = await t.db.query("SELECT recording_id FROM jobs WHERE type = 'purge_recording' ORDER BY recording_id");
      expect(purged.map((j) => j.recording_id).sort()).toEqual([t.recordingId, other.id].sort());
    });

    it("lets the host make a new studio with the same name afterwards", async () => {
      await stop();
      await expectOk(t.hostBrowser.del(`/studios/${t.studio.id}`));
      const again = await t.hostBrowser.post("/studios", { name: "My Podcast" });
      expect(again.status).toBe(201);
    });

    it("keeps other hosts out", async () => {
      await stop();
      expect((await t.client().del(`/studios/${t.studio.id}`)).status).toBe(401);
      expect((await (await otherHost()).del(`/studios/${t.studio.id}`)).status).toBe(404);
      expect((await expectOk(t.hostBrowser.get("/studios"))).body.studios).toHaveLength(1);
    });
  });
});
