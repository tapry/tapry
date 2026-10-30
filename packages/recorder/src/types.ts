export type TrackKind = "audio" | "video";

/** Metadata for one MediaRecorder chunk. Times are server-clock milliseconds. */
export interface ChunkMeta {
  sessionId: string;
  trackId: string;
  /** 0-based, gap-free within a track. The worker concatenates in this order. */
  seq: number;
  /** When this chunk's media starts: recorder start for seq 0, else the previous chunk's endTs. */
  startTs: number;
  /** When MediaRecorder emitted this chunk. */
  endTs: number;
  bytes: number;
}

export interface StoredChunk extends ChunkMeta {
  data: ArrayBuffer;
}

export interface TrackInfo {
  sessionId: string;
  trackId: string;
  kind: TrackKind;
  mimeType: string;
  startedAt: number;
  /** Set once the recorder has stopped and every chunk is in the local store. */
  stoppedAt?: number;
  /**
   * Last seq written; -1 when the recorder stopped before emitting anything.
   * null when unknown: the tab died mid-recording and earlier chunks were
   * already uploaded and deleted locally. The server then uses the highest
   * committed seq — it is exact, since completion waits for every local chunk.
   */
  lastSeq?: number | null;
  /** True when the recording ended by crash/close rather than stop(). */
  interrupted?: boolean;
  /** Opaque app data stored with the track (e.g. which recording it belongs to), for transports. */
  meta?: Record<string, string>;
}

export type CompletedTrack = TrackInfo & { stoppedAt: number; lastSeq: number | null };

/** Durable local storage for chunks that are not yet confirmed by the server. */
export interface ChunkStore {
  putTrack(info: TrackInfo): Promise<void>;
  getTrack(sessionId: string, trackId: string): Promise<TrackInfo | undefined>;
  listTracks(): Promise<TrackInfo[]>;
  deleteTrack(sessionId: string, trackId: string): Promise<void>;

  /** Must not resolve until the chunk is durable (survives a tab crash). */
  putChunk(meta: ChunkMeta, data: ArrayBuffer): Promise<void>;
  getChunk(sessionId: string, trackId: string, seq: number): Promise<StoredChunk | undefined>;
  /** Sorted by seq. Does not load chunk data. */
  listChunks(sessionId: string, trackId: string): Promise<ChunkMeta[]>;
  deleteChunk(sessionId: string, trackId: string, seq: number): Promise<void>;
}

/**
 * Moves chunks to the server. Both methods must be idempotent and must only
 * resolve once the server has durably stored the data — the caller deletes
 * the local copy as soon as `uploadChunk` resolves.
 */
export interface ChunkTransport {
  uploadChunk(chunk: StoredChunk, mimeType: string): Promise<void>;
  completeTrack(info: CompletedTrack): Promise<void>;
}
