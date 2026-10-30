import type { ChunkMeta, ChunkStore, StoredChunk, TrackInfo } from "../types.js";

const DB_VERSION = 1;
const TRACKS = "tracks";
const CHUNK_META = "chunkMeta";
const CHUNK_DATA = "chunkData";

/**
 * Durable chunk store on IndexedDB.
 *
 * Chosen over OPFS for v1: it works the same in Chrome, Firefox and Safari,
 * writes are transactional (a chunk is either fully there or not at all),
 * and it can be tested in Node with fake-indexeddb. Data is stored as
 * ArrayBuffer rather than Blob because older Safari versions lose Blobs in IDB.
 *
 * Metadata and data live in separate object stores so listing a track's
 * chunks never loads megabytes of media into memory.
 */
export class IndexedDBChunkStore implements ChunkStore {
  private constructor(private db: IDBDatabase) {}

  static async open(name = "opentake-recorder", idb: IDBFactory = indexedDB): Promise<IndexedDBChunkStore> {
    const req = idb.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(TRACKS, { keyPath: ["sessionId", "trackId"] });
      db.createObjectStore(CHUNK_META, { keyPath: ["sessionId", "trackId", "seq"] });
      db.createObjectStore(CHUNK_DATA);
    };
    return new IndexedDBChunkStore(await promisify(req));
  }

  close() {
    this.db.close();
  }

  async putTrack(info: TrackInfo) {
    const tx = this.tx([TRACKS], "readwrite");
    tx.objectStore(TRACKS).put(info);
    await done(tx);
  }

  async getTrack(sessionId: string, trackId: string) {
    const tx = this.tx([TRACKS], "readonly");
    return promisify<TrackInfo | undefined>(tx.objectStore(TRACKS).get([sessionId, trackId]));
  }

  async listTracks() {
    const tx = this.tx([TRACKS], "readonly");
    return promisify<TrackInfo[]>(tx.objectStore(TRACKS).getAll());
  }

  async deleteTrack(sessionId: string, trackId: string) {
    const tx = this.tx([TRACKS, CHUNK_META, CHUNK_DATA], "readwrite");
    tx.objectStore(TRACKS).delete([sessionId, trackId]);
    tx.objectStore(CHUNK_META).delete(trackRange(sessionId, trackId));
    tx.objectStore(CHUNK_DATA).delete(trackRange(sessionId, trackId));
    await done(tx);
  }

  async putChunk(meta: ChunkMeta, data: ArrayBuffer) {
    const tx = this.tx([CHUNK_META, CHUNK_DATA], "readwrite");
    const key = [meta.sessionId, meta.trackId, meta.seq];
    tx.objectStore(CHUNK_DATA).put(data, key);
    tx.objectStore(CHUNK_META).put(meta);
    await done(tx);
  }

  async getChunk(sessionId: string, trackId: string, seq: number) {
    const tx = this.tx([CHUNK_META, CHUNK_DATA], "readonly");
    const key = [sessionId, trackId, seq];
    const [meta, data] = await Promise.all([
      promisify<ChunkMeta | undefined>(tx.objectStore(CHUNK_META).get(key)),
      promisify<ArrayBuffer | undefined>(tx.objectStore(CHUNK_DATA).get(key)),
    ]);
    if (!meta || !data) return undefined;
    return { ...meta, data } satisfies StoredChunk;
  }

  async listChunks(sessionId: string, trackId: string) {
    const tx = this.tx([CHUNK_META], "readonly");
    // Array keys sort element-wise, so this range is ordered by seq.
    return promisify<ChunkMeta[]>(tx.objectStore(CHUNK_META).getAll(trackRange(sessionId, trackId)));
  }

  async deleteChunk(sessionId: string, trackId: string, seq: number) {
    const tx = this.tx([CHUNK_META, CHUNK_DATA], "readwrite");
    const key = [sessionId, trackId, seq];
    tx.objectStore(CHUNK_META).delete(key);
    tx.objectStore(CHUNK_DATA).delete(key);
    await done(tx);
  }

  private tx(stores: string[], mode: IDBTransactionMode) {
    // "strict" asks the browser to flush to disk before reporting success;
    // Chrome's default ("relaxed") can lose the last writes on a crash.
    return this.db.transaction(stores, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
  }
}

function trackRange(sessionId: string, trackId: string) {
  return IDBKeyRange.bound([sessionId, trackId, -Infinity], [sessionId, trackId, Infinity]);
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}
