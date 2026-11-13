/**
 * "mask" is a small picture-only video that goes with someone's camera track (where the person
 * is in the frame, for blurring the background afterwards). It is recorded, stored and uploaded
 * like any track; apps usually give it its own UploadQueue so it never holds up the real ones.
 */
export type TrackKind = "audio" | "video" | "mask";

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
 * Thrown by a transport when the server says it will never accept this track: the host
 * deleted its recording. The one case where local chunks go without the server confirming
 * each one: the server has confirmed that nobody wants them, so retrying would only fill
 * the disk. Recognised by its `trackGone` flag, so it works across bundles.
 */
export class TrackGoneError extends Error {
  readonly trackGone = true;
}

export function isTrackGone(err: unknown): err is TrackGoneError {
  return typeof err === "object" && err !== null && (err as { trackGone?: unknown }).trackGone === true;
}

/**
 * Moves chunks to the server. Both methods must be idempotent and must only
 * resolve once the server has durably stored the data — the caller deletes
 * the local copy as soon as `uploadChunk` resolves.
 */
export interface ChunkTransport {
  uploadChunk(chunk: StoredChunk, mimeType: string): Promise<void>;
  completeTrack(info: CompletedTrack): Promise<void>;
  // Either may throw TrackGoneError: the queue then drops the whole track locally.
}
