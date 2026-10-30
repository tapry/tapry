import { MemoryChunkStore, UploadQueue, createHttpTransport, type ChunkMeta } from "@opentake/recorder";
import { chunkStorageKey, type SessionState } from "@opentake/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeStorage, setup, sha256 } from "./harness";

const MIME = "audio/webm;codecs=opus";

describe("upload API", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let storage: FakeStorage;

  beforeEach(async () => {
    storage = new FakeStorage();
    t = await setup(storage);
  });

  const createTrack = async (token = t.guest.token) => {
    const res = await t.call(
      `/sessions/${t.sessionId}/tracks`,
      { recordingId: t.recordingId, kind: "audio", mimeType: MIME, startedAt: 1000 },
      token,
    );
    expect(res.status).toBe(201);
    return res.body.trackId as string;
  };

  /** upload-url + simulated PUT + commit for one chunk. */
  const upload = async (trackId: string, seq: number, content = `chunk-${seq}`) => {
    const meta = { bytes: Buffer.byteLength(content), sha256: sha256(content) };
    const url = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/upload-url`, { ...meta, mimeType: MIME });
    expect(url.status).toBe(200);
    storage.put(chunkStorageKey(t.sessionId, trackId, seq), content);
    return t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/commit`, {
      ...meta,
      startTs: 1000 + seq * 4000,
      endTs: 5000 + seq * 4000,
    });
  };

  const complete = (trackId: string, body: Record<string, unknown>) =>
    t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: 99_000, ...body });

  it("runs the full create → upload → commit → complete flow", async () => {
    const trackId = await createTrack();
    expect(trackId).toMatch(/^trk_/);

    const url = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/upload-url`, {
      bytes: 7,
      sha256: sha256("chunk-0"),
      mimeType: "something/else",
    });
    expect(url.body.url).toContain(`recordings/${t.sessionId}/${trackId}/00000000.chunk`);
    expect(storage.signed[0]).toMatchObject({ bytes: 7, contentType: MIME }); // the track's type wins

    for (const seq of [0, 1, 2]) expect((await upload(trackId, seq)).status).toBe(200);
    const done = await complete(trackId, { lastSeq: 2 });
    expect(done.body).toEqual({ trackId, status: "complete", lastSeq: 2, missingSeqs: [] });

    const [row] = await t.db.query<any>("SELECT status, stopped_at, last_seq FROM tracks WHERE id = $1", [trackId]);
    expect(row).toEqual({ status: "complete", stopped_at: 99_000, last_seq: 2 });
    const chunks = await t.db.query<any>("SELECT seq, start_ts, bytes FROM chunks ORDER BY seq");
    expect(chunks).toEqual([
      { seq: 0, start_ts: 1000, bytes: 7 },
      { seq: 1, start_ts: 5000, bytes: 7 },
      { seq: 2, start_ts: 9000, bytes: 7 },
    ]);
  });

  describe("auth", () => {
    it("rejects requests without a valid token", async () => {
      expect((await t.call(`/sessions/${t.sessionId}/tracks`, {}, null)).status).toBe(401);
      expect((await t.call(`/sessions/${t.sessionId}/tracks`, {}, "made-up")).status).toBe(401);
    });

    it("rejects a token from another session", async () => {
      const otherStudio = (await t.hostBrowser.post("/studios", { name: "Other" })).body;
      const outsider = (await t.hostBrowser.post(`/studios/${otherStudio.id}/open`)).body;
      const res = await t.call(
        `/sessions/${t.sessionId}/tracks`,
        { recordingId: t.recordingId, kind: "audio", mimeType: MIME, startedAt: 1 },
        outsider.token,
      );
      expect(res.status).toBe(403);
    });

    it("hides other participants' tracks", async () => {
      const hostTrack = await createTrack(t.host.token);
      const res = await t.call(`/sessions/${t.sessionId}/tracks/${hostTrack}/chunks/0/upload-url`, {
        bytes: 1,
        sha256: sha256("x"),
        mimeType: MIME,
      });
      expect(res).toMatchObject({ status: 404, body: { error: "track_not_found" } });
    });

    it("stores only a hash of the token", async () => {
      const rows = await t.db.query<{ token_hash: string }>("SELECT token_hash FROM participants");
      expect(rows.map((r) => r.token_hash)).not.toContain(t.guest.token);
    });
  });

  describe("client-chosen track ids", () => {
    const body = (trackId: string) => ({ trackId, recordingId: t.recordingId, kind: "audio", mimeType: MIME, startedAt: 1 });

    it("registers with the client's id, and a repeat is harmless", async () => {
      const first = await t.call(`/sessions/${t.sessionId}/tracks`, body("trk_clientchosen00000001"));
      const again = await t.call(`/sessions/${t.sessionId}/tracks`, body("trk_clientchosen00000001"));
      expect(first.body).toEqual({ trackId: "trk_clientchosen00000001" });
      expect(again.status).toBe(201);
      expect(await t.db.query("SELECT id FROM tracks WHERE id = 'trk_clientchosen00000001'")).toHaveLength(1);
    });

    it("refuses an id another participant already uses", async () => {
      await t.call(`/sessions/${t.sessionId}/tracks`, body("trk_clientchosen00000002"));
      const res = await t.call(`/sessions/${t.sessionId}/tracks`, body("trk_clientchosen00000002"), t.host.token);
      expect(res).toMatchObject({ status: 409, body: { error: "track_id_taken" } });
    });

    it("rejects malformed ids", async () => {
      const res = await t.call(`/sessions/${t.sessionId}/tracks`, body("not-a-track-id"));
      expect(res.body.error).toBe("invalid_body");
    });
  });

  describe("idempotency", () => {
    it("answers {committed: true} for a chunk that is already stored with the same content", async () => {
      const trackId = await createTrack();
      await upload(trackId, 0, "abc");
      const again = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/upload-url`, {
        bytes: 3,
        sha256: sha256("abc"),
        mimeType: MIME,
      });
      expect(again.body).toEqual({ committed: true });
    });

    it("refuses to overwrite a committed chunk with different content", async () => {
      const trackId = await createTrack();
      await upload(trackId, 0, "abc");
      const res = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/upload-url`, {
        bytes: 3,
        sha256: sha256("xyz"),
        mimeType: MIME,
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("chunk_conflict");
    });

    it("accepts a repeated commit", async () => {
      const trackId = await createTrack();
      await upload(trackId, 0);
      const body = { bytes: 7, sha256: sha256("chunk-0"), startTs: 1000, endTs: 5000 };
      expect((await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/commit`, body)).status).toBe(200);
      expect(await t.db.query("SELECT * FROM chunks")).toHaveLength(1);
    });

    it("returns the same result for a repeated completion", async () => {
      const trackId = await createTrack();
      await upload(trackId, 0);
      const first = await complete(trackId, { lastSeq: 0 });
      const second = await complete(trackId, { lastSeq: 5, stoppedAt: 1 });
      expect(second.body).toEqual(first.body);
    });
  });

  describe("commit checks storage", () => {
    it("rejects a commit when nothing was uploaded", async () => {
      const trackId = await createTrack();
      const res = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/commit`, {
        bytes: 3,
        sha256: sha256("abc"),
        startTs: 0,
        endTs: 1,
      });
      expect(res.body.error).toBe("not_uploaded");
    });

    it("rejects a size mismatch", async () => {
      const trackId = await createTrack();
      storage.put(chunkStorageKey(t.sessionId, trackId, 0), "abcd");
      const res = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/commit`, {
        bytes: 3,
        sha256: sha256("abc"),
        startTs: 0,
        endTs: 1,
      });
      expect(res.body.error).toBe("size_mismatch");
    });

    it("rejects a checksum mismatch when storage reports one, and trusts size otherwise", async () => {
      const trackId = await createTrack();
      storage.put(chunkStorageKey(t.sessionId, trackId, 0), "abd");
      const body = { bytes: 3, sha256: sha256("abc"), startTs: 0, endTs: 1 };
      const res = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/commit`, body);
      expect(res.body.error).toBe("checksum_mismatch");

      storage.reportsChecksum = false;
      expect((await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/commit`, body)).status).toBe(200);
    });
  });

  describe("completion", () => {
    it("records gaps instead of rejecting", async () => {
      const trackId = await createTrack();
      for (const seq of [0, 2, 4]) await upload(trackId, seq);
      const res = await complete(trackId, { lastSeq: 5 });
      expect(res.body).toEqual({ trackId, status: "complete", lastSeq: 5, missingSeqs: [1, 3, 5] });
    });

    it("uses the highest committed seq for an interrupted track with unknown length", async () => {
      const trackId = await createTrack();
      for (const seq of [0, 1, 2]) await upload(trackId, seq);
      const res = await complete(trackId, { lastSeq: null, interrupted: true });
      expect(res.body).toEqual({ trackId, status: "interrupted", lastSeq: 2, missingSeqs: [] });
    });

    it("handles a track that recorded nothing", async () => {
      const trackId = await createTrack();
      expect((await complete(trackId, { lastSeq: -1 })).body).toMatchObject({ lastSeq: -1, missingSeqs: [] });
    });

    it("closes the track to new chunks", async () => {
      const trackId = await createTrack();
      await complete(trackId, { lastSeq: -1 });
      const res = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/upload-url`, {
        bytes: 1,
        sha256: sha256("x"),
        mimeType: MIME,
      });
      expect(res.body.error).toBe("track_closed");
    });
  });

  describe("validation", () => {
    it("rejects bad seqs, bad bodies and non-JSON", async () => {
      const trackId = await createTrack();
      const base = `/sessions/${t.sessionId}/tracks/${trackId}/chunks`;
      const good = { bytes: 1, sha256: sha256("x"), mimeType: MIME };
      expect((await t.call(`${base}/-1/upload-url`, good)).body.error).toBe("invalid_seq");
      expect((await t.call(`${base}/1.5/upload-url`, good)).body.error).toBe("invalid_seq");
      expect((await t.call(`${base}/0/upload-url`, { ...good, sha256: "nope" })).body.error).toBe("invalid_body");
      expect((await t.call(`${base}/0/upload-url`, { ...good, bytes: 1e9 })).body.error).toBe("invalid_body");
      expect((await t.call(`${base}/0/upload-url`, "{not json")).body.error).toBe("invalid_json");
      const backwards = await t.call(`${base}/0/commit`, { bytes: 1, sha256: sha256("x"), startTs: 5, endTs: 4 });
      expect(backwards.body.error).toBe("invalid_body");
    });

    it("refuses tracks that started after Stop, but keeps accepting chunks for existing ones", async () => {
      const trackId = await createTrack();
      await t.call(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`, {}, t.host.token);
      const res = await t.call(`/sessions/${t.sessionId}/tracks`, {
        recordingId: t.recordingId,
        kind: "audio",
        mimeType: MIME,
        startedAt: t.now() + 60_000,
      });
      expect(res.body.error).toBe("recording_stopped");
      // Uploads lag behind the recording; Stop must not cut them off.
      expect((await upload(trackId, 0)).status).toBe(200);
    });

    it("accepts a late registration for a track that started before Stop (guest was offline)", async () => {
      const startedAt = t.now();
      t.tick(30_000);
      await t.call(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`, {}, t.host.token);
      t.tick(120_000); // the guest comes back online two minutes later
      const res = await t.call(`/sessions/${t.sessionId}/tracks`, {
        trackId: "trk_offlineguest0000000",
        recordingId: t.recordingId,
        kind: "audio",
        mimeType: MIME,
        startedAt,
      });
      expect(res).toMatchObject({ status: 201, body: { trackId: "trk_offlineguest0000000" } });
    });

    it("rejects a track for a recording in another session", async () => {
      const res = await t.call(`/sessions/${t.sessionId}/tracks`, {
        recordingId: "rec_doesnotexist",
        kind: "audio",
        mimeType: MIME,
        startedAt: 1,
      });
      expect(res.status).toBe(404);
    });
  });

  it("reports each participant's upload progress in the session state", async () => {
    const audio = await createTrack();
    const video = (
      await t.call(`/sessions/${t.sessionId}/tracks`, { recordingId: t.recordingId, kind: "video", mimeType: MIME, startedAt: 1 })
    ).body.trackId;
    await upload(audio, 0, "12345");
    await upload(video, 0, "1234567890");
    await complete(audio, { lastSeq: 0 });

    const state = (await t.client({ token: t.host.token }).get(`/sessions/${t.sessionId}/state`)).body;
    expect(state.uploads).toEqual([{ participantId: t.guest.participantId, tracks: 2, completeTracks: 1, bytes: 15 }]);
  });

  it("pushes upload progress to subscribers, throttled", async () => {
    const seen: Array<SessionState["uploads"]> = [];
    const unsubscribe = await t.services.live.subscribe(t.sessionId, (s) => seen.push(s.uploads));
    const trackId = await createTrack();
    await upload(trackId, 0);
    await upload(trackId, 1);
    expect(seen).toHaveLength(1); // only the initial snapshot so far: updates are batched
    await new Promise((r) => setTimeout(r, 1100));
    unsubscribe();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual([{ participantId: t.guest.participantId, tracks: 1, completeTracks: 0, bytes: 14 }]);
  });

  it("works with the real recorder upload queue and HTTP transport", async () => {
    const trackId = await createTrack();
    const store = new MemoryChunkStore();
    const transport = createHttpTransport({
      baseUrl: "https://app.test/api",
      fetch: t.fetchFor(),
      headers: () => ({ authorization: `Bearer ${t.guest.token}` }),
    });
    const queue = new UploadQueue({ store, transport });
    const track = { sessionId: t.sessionId, trackId, kind: "audio" as const, mimeType: MIME, startedAt: 1000 };
    await store.putTrack(track);

    for (let seq = 0; seq < 5; seq++) {
      const data = new TextEncoder().encode(`media-${seq}`).buffer as ArrayBuffer;
      const meta: ChunkMeta = { sessionId: t.sessionId, trackId, seq, startTs: seq, endTs: seq + 1, bytes: data.byteLength };
      await store.putChunk(meta, data);
      queue.enqueue(meta);
    }
    queue.finishTrack({ ...track, stoppedAt: 50_000, lastSeq: 4 });
    await queue.drain();
    queue.close();

    expect(queue.progress().lastError).toBeNull();
    expect(await store.listTracks()).toEqual([]);
    const [row] = await t.db.query<any>("SELECT status, last_seq, missing_seqs FROM tracks WHERE id = $1", [trackId]);
    expect(row).toEqual({ status: "complete", last_seq: 4, missing_seqs: [] });
    expect(storage.objects.size).toBe(5);
  });
});
