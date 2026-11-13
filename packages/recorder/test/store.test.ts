import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { IndexedDBChunkStore } from "../src/store/indexeddb.js";
import { MemoryChunkStore } from "../src/store/memory.js";
import type { ChunkMeta, ChunkStore } from "../src/types.js";
import { bytes, text } from "./fakes.js";

const stores: Array<[string, () => Promise<ChunkStore>]> = [
  ["MemoryChunkStore", async () => new MemoryChunkStore()],
  ["IndexedDBChunkStore", () => IndexedDBChunkStore.open("test", new IDBFactory())],
];

const meta = (trackId: string, seq: number, data = `${trackId}-${seq}`): [ChunkMeta, ArrayBuffer] => {
  const buf = bytes(data);
  return [{ sessionId: "s1", trackId, seq, startTs: seq * 1000, endTs: (seq + 1) * 1000, bytes: buf.byteLength }, buf];
};

describe.each(stores)("%s", (_name, open) => {
  it("round-trips chunk data and metadata", async () => {
    const store = await open();
    await store.putChunk(...meta("t1", 0, "hello"));
    const chunk = await store.getChunk("s1", "t1", 0);
    expect(chunk).toMatchObject({ sessionId: "s1", trackId: "t1", seq: 0, startTs: 0, endTs: 1000, bytes: 5 });
    expect(text(chunk!.data)).toBe("hello");
    expect(await store.getChunk("s1", "t1", 1)).toBeUndefined();
  });

  it("lists a track's chunks in numeric seq order, without other tracks", async () => {
    const store = await open();
    for (const seq of [10, 2, 1]) await store.putChunk(...meta("t", seq));
    await store.putChunk(...meta("t2", 0)); // trackId that shares a prefix
    await store.putChunk(...meta("u", 5));
    const listed = await store.listChunks("s1", "t");
    expect(listed.map((c) => c.seq)).toEqual([1, 2, 10]);
    expect(listed[0]).not.toHaveProperty("data");
  });

  it("deletes a single chunk", async () => {
    const store = await open();
    await store.putChunk(...meta("t1", 0));
    await store.putChunk(...meta("t1", 1));
    await store.deleteChunk("s1", "t1", 0);
    expect((await store.listChunks("s1", "t1")).map((c) => c.seq)).toEqual([1]);
    expect(await store.getChunk("s1", "t1", 0)).toBeUndefined();
  });

  it("deleteTrack removes the track and only its chunks", async () => {
    const store = await open();
    const track = { sessionId: "s1", kind: "audio" as const, mimeType: "audio/webm", startedAt: 0 };
    await store.putTrack({ ...track, trackId: "t1" });
    await store.putTrack({ ...track, trackId: "t2" });
    await store.putChunk(...meta("t1", 0));
    await store.putChunk(...meta("t2", 0));

    await store.deleteTrack("s1", "t1");

    expect((await store.listTracks()).map((t) => t.trackId)).toEqual(["t2"]);
    expect(await store.getTrack("s1", "t1")).toBeUndefined();
    expect(await store.listChunks("s1", "t1")).toEqual([]);
    expect(await store.listChunks("s1", "t2")).toHaveLength(1);
  });

  it("putTrack overwrites the existing record", async () => {
    const store = await open();
    const track = { sessionId: "s1", trackId: "t1", kind: "video" as const, mimeType: "video/webm", startedAt: 5 };
    await store.putTrack(track);
    await store.putTrack({ ...track, stoppedAt: 9, lastSeq: 3 });
    expect(await store.getTrack("s1", "t1")).toEqual({ ...track, stoppedAt: 9, lastSeq: 3 });
  });
});

describe("the database's name", () => {
  it("is tapry-recorder in a browser that never recorded before", async () => {
    const idb = new IDBFactory();
    (await IndexedDBChunkStore.open(undefined, idb)).close();
    expect((await idb.databases()).map((d) => d.name)).toEqual(["tapry-recorder"]);
  });

  it("stays opentake-recorder where that database exists, so chunks not yet uploaded are found", async () => {
    const idb = new IDBFactory();
    const before = await IndexedDBChunkStore.open("opentake-recorder", idb);
    await before.putTrack({ sessionId: "s1", trackId: "t1", kind: "audio", mimeType: "audio/webm", startedAt: 1 } as never);
    before.close();
    const now = await IndexedDBChunkStore.open(undefined, idb);
    expect((await now.listTracks()).map((t) => t.trackId)).toEqual(["t1"]);
    now.close();
    expect((await idb.databases()).map((d) => d.name)).toEqual(["opentake-recorder"]);
  });

  it("uses the old name where the browser can't list its databases", async () => {
    const idb = new IDBFactory();
    const blind = { open: idb.open.bind(idb) } as unknown as IDBFactory;
    (await IndexedDBChunkStore.open(undefined, blind)).close();
    expect((await idb.databases()).map((d) => d.name)).toEqual(["opentake-recorder"]);
  });
});
