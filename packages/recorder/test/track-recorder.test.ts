import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryChunkStore } from "../src/store/memory.js";
import { ChunkNotPersistedError, RecorderStalledError, TrackRecorder } from "../src/track-recorder.js";
import type { ChunkMeta } from "../src/types.js";
import { UploadQueue } from "../src/upload-queue.js";
import { asMediaRecorder, FakeMediaRecorder, FakeTransport, fakeStream, flush, text } from "./fakes.js";

describe("TrackRecorder", () => {
  let store: MemoryChunkStore;
  let transport: FakeTransport;
  let queue: UploadQueue;
  let clock: number;
  const errors: unknown[] = [];

  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    errors.length = 0;
    store = new MemoryChunkStore();
    transport = new FakeTransport();
    queue = new UploadQueue({ store, transport });
    clock = 1_000;
  });

  const make = (overrides: Partial<ConstructorParameters<typeof TrackRecorder>[0]> = {}) =>
    new TrackRecorder({
      sessionId: "s1",
      trackId: "cam",
      kind: "video",
      stream: fakeStream,
      store,
      queue,
      now: () => clock,
      onError: (e) => errors.push(e),
      MediaRecorder: asMediaRecorder,
      ...overrides,
    });

  it("records ordered chunks, uploads them and completes the track", async () => {
    const rec = make({ videoBitsPerSecond: 8_000_000 });
    await rec.start();
    const mr = FakeMediaRecorder.instances[0]!;
    expect(rec.mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(mr.options).toMatchObject({ mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: 8_000_000 });
    expect(mr.timeslice).toBe(4000);

    for (const part of ["header+a", "b", "c"]) {
      clock += 4000;
      mr.emit(part);
    }
    mr.tailBytes = 7;
    clock += 1500;
    const info = await rec.stop();
    await queue.drain();

    expect(info).toMatchObject({ lastSeq: 3, startedAt: 1000, stoppedAt: 14_500, mimeType: rec.mimeType });
    expect(rec.state).toBe("stopped");
    expect(text(transport.uploaded.get("cam/0")!.data)).toBe("header+a");
    expect(transport.uploaded.size).toBe(4);
    expect(transport.completed).toEqual([info]);
    expect(await store.listTracks()).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("chains chunk timestamps from the recorder start", async () => {
    const rec = make();
    await rec.start();
    const mr = FakeMediaRecorder.instances[0]!;
    clock = 5_000;
    mr.emit("a");
    clock = 9_100;
    mr.emit("b");
    await rec.stop();
    await queue.drain();

    const times = [...transport.uploaded.values()].map(({ seq, startTs, endTs }) => ({ seq, startTs, endTs }));
    expect(times).toEqual([
      { seq: 0, startTs: 1_000, endTs: 5_000 },
      { seq: 1, startTs: 5_000, endTs: 9_100 },
    ]);
  });

  it("persists chunks in seq order even when storage writes are slow and uneven", async () => {
    const order: number[] = [];
    const put = store.putChunk.bind(store);
    store.putChunk = async (meta: ChunkMeta, data: ArrayBuffer) => {
      await new Promise((r) => setTimeout(r, meta.seq % 2 ? 1 : 15));
      order.push(meta.seq);
      return put(meta, data);
    };
    const rec = make();
    await rec.start();
    const mr = FakeMediaRecorder.instances[0]!;
    for (let i = 0; i < 6; i++) mr.emit(10);
    await rec.stop();
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("skips empty chunks without using up a seq number", async () => {
    const rec = make();
    await rec.start();
    const mr = FakeMediaRecorder.instances[0]!;
    mr.emit("a");
    mr.emit("");
    mr.emit("b");
    const info = await rec.stop();
    await queue.drain();
    expect(info.lastSeq).toBe(1);
    expect([...transport.uploaded.keys()].sort()).toEqual(["cam/0", "cam/1"]);
  });

  it("still uploads a chunk from memory when the local store fails", async () => {
    store.putChunk = async () => {
      throw new DOMException("disk full", "QuotaExceededError");
    };
    const rec = make();
    await rec.start();
    FakeMediaRecorder.instances[0]!.emit("precious");
    await rec.stop();
    await queue.drain();

    expect(errors[0]).toBeInstanceOf(ChunkNotPersistedError);
    expect(text(transport.uploaded.get("cam/0")!.data)).toBe("precious");
    expect(transport.completed[0]!.lastSeq).toBe(0);
  });

  it("completes the track and reports an error when MediaRecorder stops by itself", async () => {
    const rec = make();
    await rec.start();
    const mr = FakeMediaRecorder.instances[0]!;
    mr.emit("a");
    mr.stop(); // e.g. camera unplugged
    await flush();
    await queue.drain();

    expect(rec.state).toBe("stopped");
    expect(String(errors[0])).toMatch(/stopped unexpectedly/);
    expect(transport.completed[0]!.lastSeq).toBe(0);
    expect(await rec.stop()).toEqual(transport.completed[0]);
  });

  it("keeps app metadata on the track through to completion", async () => {
    const rec = make({ meta: { recordingId: "rec_1" } });
    await rec.start();
    expect((await store.getTrack("s1", "cam"))?.meta).toEqual({ recordingId: "rec_1" });
    const info = await rec.stop();
    await queue.drain();
    expect(info.meta).toEqual({ recordingId: "rec_1" });
    expect(transport.completed[0]!.meta).toEqual({ recordingId: "rec_1" });
  });

  it("picks an audio format for audio tracks", async () => {
    const rec = make({ kind: "audio" });
    await rec.start();
    expect(rec.mimeType).toBe("audio/webm;codecs=opus");
  });

  it("refuses to start twice", async () => {
    const rec = make();
    await rec.start();
    await expect(rec.start()).rejects.toThrow(/state "recording"/);
  });

  it("says so when MediaRecorder stops by itself, after its chunks are safe", async () => {
    const stops: string[] = [];
    const rec = make({ onUnexpectedStop: () => stops.push(rec.state) });
    await rec.start();
    FakeMediaRecorder.instances[0]!.emit("a");
    FakeMediaRecorder.instances[0]!.stop();
    await rec.stop();
    expect(stops).toEqual(["stopped"]);
    expect(errors).toEqual([expect.objectContaining({ message: "Recording stopped unexpectedly" })]);
  });

  it("doesn't report a normal stop as unexpected", async () => {
    const stops: string[] = [];
    const rec = make({ onUnexpectedStop: () => stops.push("x") });
    await rec.start();
    await rec.stop();
    expect(stops).toEqual([]);
  });

  it("reports a recorder that stops producing chunks, and when it recovers", async () => {
    vi.useFakeTimers();
    try {
      let recovered = 0;
      const rec = make({ stallMs: 15_000, onRecovered: () => recovered++ });
      await rec.start();
      clock += 14_000;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(errors).toEqual([]);
      clock += 2_000;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(errors).toEqual([expect.any(RecorderStalledError)]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(errors).toHaveLength(1); // once per stall
      FakeMediaRecorder.instances[0]!.emit("a");
      expect(recovered).toBe(1);
      await rec.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
