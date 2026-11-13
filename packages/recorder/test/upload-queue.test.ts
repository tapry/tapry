import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryChunkStore } from "../src/store/memory.js";
import { TrackGoneError, type ChunkMeta, type TrackInfo } from "../src/types.js";
import { UploadQueue, type UploadProgress } from "../src/upload-queue.js";
import { bytes, FakeTransport } from "./fakes.js";

const track: TrackInfo = { sessionId: "s1", trackId: "t1", kind: "audio", mimeType: "audio/webm", startedAt: 0 };

async function putChunks(store: MemoryChunkStore, n: number, trackId = "t1") {
  const metas: ChunkMeta[] = [];
  for (let seq = 0; seq < n; seq++) {
    const data = bytes(`chunk-${seq}`);
    const meta = { sessionId: "s1", trackId, seq, startTs: seq * 4000, endTs: (seq + 1) * 4000, bytes: data.byteLength };
    await store.putChunk(meta, data);
    metas.push(meta);
  }
  return metas;
}

describe("UploadQueue", () => {
  let store: MemoryChunkStore;
  let transport: FakeTransport;
  let queue: UploadQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new MemoryChunkStore();
    transport = new FakeTransport();
    queue = new UploadQueue({ store, transport, random: () => 1 });
  });

  afterEach(() => {
    queue.close();
    vi.useRealTimers();
  });

  it("uploads queued chunks and then deletes them locally", async () => {
    await store.putTrack(track);
    for (const m of await putChunks(store, 3)) queue.enqueue(m);
    await queue.drain();

    expect([...transport.uploaded.keys()].sort()).toEqual(["t1/0", "t1/1", "t1/2"]);
    expect(transport.uploaded.get("t1/0")!.mimeType).toBe("audio/webm");
    expect(await store.listChunks("s1", "t1")).toEqual([]);
  });

  it("keeps a chunk locally while uploads fail, and retries with backoff", async () => {
    transport.failNext = 2;
    const [m] = await putChunks(store, 1);
    queue.enqueue(m!);

    await vi.advanceTimersByTimeAsync(0);
    expect(transport.uploadCalls).toBe(1);
    expect(await store.listChunks("s1", "t1")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(transport.uploadCalls).toBe(1); // 500 ms backoff not elapsed
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.uploadCalls).toBe(2);
    expect(await store.listChunks("s1", "t1")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000); // second backoff doubles
    expect(transport.uploadCalls).toBe(3);
    await queue.drain();
    expect(await store.listChunks("s1", "t1")).toEqual([]);
    expect(transport.uploaded.has("t1/0")).toBe(true);
  });

  it("never deletes local chunks while the server is unreachable", async () => {
    transport.failAll = true;
    for (const m of await putChunks(store, 5)) queue.enqueue(m);
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(transport.uploadCalls).toBeGreaterThan(5);
    expect(await store.listChunks("s1", "t1")).toHaveLength(5);
    expect(queue.progress()).toMatchObject({ pendingChunks: 5, idle: false });
    expect(queue.progress().lastError).toBeInstanceOf(Error);

    transport.failAll = false;
    await vi.advanceTimersByTimeAsync(30_000); // backoff is capped at 30 s
    await queue.drain();
    expect(transport.uploaded.size).toBe(5);
  });

  it("retryNow skips the remaining backoff", async () => {
    transport.failNext = 5;
    const [m] = await putChunks(store, 1);
    queue.enqueue(m!);
    await vi.advanceTimersByTimeAsync(0);
    const calls = transport.uploadCalls;
    queue.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.uploadCalls).toBe(calls + 1);
  });

  it("limits parallel uploads", async () => {
    queue.close();
    queue = new UploadQueue({ store, transport, concurrency: 2 });
    transport.delayMs = 50;
    for (const m of await putChunks(store, 8)) queue.enqueue(m);
    await vi.advanceTimersByTimeAsync(1000);
    await queue.drain();
    expect(transport.uploaded.size).toBe(8);
    expect(transport.maxInflight).toBe(2);
  });

  it("uploads the oldest chunks first", async () => {
    queue.close();
    queue = new UploadQueue({ store, transport, concurrency: 1 });
    const order: number[] = [];
    const upload = transport.uploadChunk.bind(transport);
    transport.uploadChunk = async (c, mime) => (order.push(c.seq), upload(c, mime));
    const metas = await putChunks(store, 4);
    for (const m of [metas[3]!, metas[1]!, metas[0]!, metas[2]!]) queue.enqueue(m);
    await queue.drain();
    // The first enqueue starts immediately; the rest go oldest-first.
    expect(order).toEqual([3, 0, 1, 2]);
  });

  it("completes a track only after all its chunks are uploaded, then clears it locally", async () => {
    transport.delayMs = 100;
    await store.putTrack(track);
    for (const m of await putChunks(store, 3)) queue.enqueue(m);
    queue.finishTrack({ ...track, stoppedAt: 12_000, lastSeq: 2 });

    await vi.advanceTimersByTimeAsync(50);
    expect(transport.completed).toEqual([]);

    await vi.advanceTimersByTimeAsync(500);
    await queue.drain();
    expect(transport.completed).toEqual([{ ...track, stoppedAt: 12_000, lastSeq: 2 }]);
    expect(await store.listTracks()).toEqual([]);
  });

  it("retries a failed track completion", async () => {
    transport.failComplete = 1;
    await store.putTrack(track);
    queue.finishTrack({ ...track, stoppedAt: 1, lastSeq: -1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.completed).toEqual([]);
    expect(await store.listTracks()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    await queue.drain();
    expect(transport.completed).toHaveLength(1);
  });

  it("uploads chunks that only exist in memory", async () => {
    const data = bytes("not on disk");
    queue.enqueue({ sessionId: "s1", trackId: "t1", seq: 0, startTs: 0, endTs: 1, bytes: data.byteLength }, data);
    await queue.drain();
    expect(new TextDecoder().decode(transport.uploaded.get("t1/0")!.data)).toBe("not on disk");
  });

  it("reports progress, including how far behind the upload is", async () => {
    transport.failAll = true;
    const updates: UploadProgress[] = [];
    queue.close();
    queue = new UploadQueue({ store, transport, onProgress: (p) => updates.push(p) });
    const metas = await putChunks(store, 3);
    for (const m of metas) queue.enqueue(m);
    await vi.advanceTimersByTimeAsync(0);

    const p = queue.progress();
    expect(p.pendingChunks).toBe(3);
    expect(p.pendingBytes).toBe(metas.reduce((n, m) => n + m.bytes, 0));
    expect(p.oldestPendingTs).toBe(4000);
    expect(updates.length).toBeGreaterThan(0);

    transport.failAll = false;
    queue.retryNow();
    await queue.drain();
    expect(queue.progress()).toMatchObject({ pendingChunks: 0, uploadedChunks: 3, oldestPendingTs: null, idle: true });
  });

  describe("resume", () => {
    it("uploads leftovers of a stopped track and completes it", async () => {
      await store.putTrack({ ...track, stoppedAt: 20_000, lastSeq: 4 });
      const metas = await putChunks(store, 5);
      for (const m of metas.slice(0, 2)) await store.deleteChunk("s1", "t1", m.seq); // uploaded before the crash

      await queue.resume();
      await queue.drain();

      expect([...transport.uploaded.keys()].sort()).toEqual(["t1/2", "t1/3", "t1/4"]);
      expect(transport.completed).toEqual([{ ...track, stoppedAt: 20_000, lastSeq: 4 }]);
      expect(await store.listTracks()).toEqual([]);
    });

    it("completes a track that crashed mid-recording as interrupted", async () => {
      await store.putTrack(track); // never reached stop()
      await putChunks(store, 3);

      await queue.resume();
      await queue.drain();

      expect(transport.uploaded.size).toBe(3);
      expect(transport.completed).toEqual([{ ...track, stoppedAt: 12_000, lastSeq: null, interrupted: true }]);
    });

    it("takes only the tracks it is asked to, when two queues share a store", async () => {
      const mask: TrackInfo = { ...track, trackId: "m1", kind: "mask", mimeType: "video/webm;codecs=vp8" };
      await store.putTrack({ ...track, stoppedAt: 8_000, lastSeq: 1 });
      await store.putTrack({ ...mask, stoppedAt: 8_000, lastSeq: 1 });
      await putChunks(store, 2);
      await putChunks(store, 2, "m1");
      const maskTransport = new FakeTransport();
      const maskQueue = new UploadQueue({ store, transport: maskTransport, random: () => 1 });
      try {
        await queue.resume({ only: (t) => t.kind !== "mask" });
        await queue.drain();
        // The recording's queue is done and idle while the mask's chunks still wait.
        expect([...transport.uploaded.keys()].sort()).toEqual(["t1/0", "t1/1"]);
        expect(queue.progress()).toMatchObject({ idle: true, pendingChunks: 0, pendingTracks: 0 });
        expect(await store.listChunks("s1", "m1")).toHaveLength(2);

        await maskQueue.resume({ only: (t) => t.kind === "mask" });
        await maskQueue.drain();
        expect([...maskTransport.uploaded.keys()].sort()).toEqual(["m1/0", "m1/1"]);
        expect(maskTransport.completed.map((t) => t.kind)).toEqual(["mask"]);
        expect(await store.listTracks()).toEqual([]);
      } finally {
        maskQueue.close();
      }
    });

    it("skips tracks a live recorder in another tab still holds", async () => {
      const held = { held: [{ name: "opentake:track:s1:t1" }] };
      vi.stubGlobal("navigator", { locks: { query: async () => held } });
      try {
        await store.putTrack(track);
        await putChunks(store, 2);
        await queue.resume();
        await queue.drain();
        expect(transport.uploadCalls).toBe(0);
        expect(await store.listChunks("s1", "t1")).toHaveLength(2);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("drops a track the server says is gone (recording deleted), and keeps uploading the others", async () => {
    await store.putTrack(track);
    await store.putTrack({ ...track, trackId: "t2" });
    const gone = await putChunks(store, 3);
    const kept = await putChunks(store, 2, "t2");
    const upload = transport.uploadChunk.bind(transport);
    transport.uploadChunk = async (chunk, mimeType) => {
      if (chunk.trackId === "t1") {
        transport.uploadCalls++;
        throw new TrackGoneError("deleted");
      }
      return upload(chunk, mimeType);
    };
    for (const m of [...gone, ...kept]) queue.enqueue(m);
    queue.finishTrack({ ...track, stoppedAt: 12_000, lastSeq: 2 });
    queue.finishTrack({ ...track, trackId: "t2", stoppedAt: 8000, lastSeq: 1 });
    await queue.drain();

    expect(await store.getTrack("s1", "t1")).toBeUndefined();
    expect(await store.listChunks("s1", "t1")).toEqual([]);
    expect(transport.completed.map((c) => c.trackId)).toEqual(["t2"]);
    expect([...transport.uploaded.keys()].sort()).toEqual(["t2/0", "t2/1"]);
    // Every t1 chunk was tried at most once: no retry loop after the first 410.
    expect(transport.uploadCalls).toBeLessThanOrEqual(3 + 2);
    expect(queue.progress().lastError).toBeNull();

    // A chunk of that track turning up again (another tab, a reload) is ignored.
    queue.enqueue(gone[0]!);
    expect(queue.progress().pendingChunks).toBe(0);
  });

  it("drops the track when only its completion is refused as gone", async () => {
    await store.putTrack(track);
    transport.completeTrack = async () => {
      throw new TrackGoneError("deleted");
    };
    queue.finishTrack({ ...track, stoppedAt: 1000, lastSeq: -1 });
    await queue.drain();
    expect(await store.listTracks()).toEqual([]);
  });
});
