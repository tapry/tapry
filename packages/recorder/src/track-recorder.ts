import { pickMimeType } from "./codecs.js";
import { holdLock, trackLockName } from "./locks.js";
import type { ChunkMeta, ChunkStore, CompletedTrack, TrackInfo, TrackKind } from "./types.js";
import type { UploadQueue } from "./upload-queue.js";

export interface TrackRecorderOptions {
  sessionId: string;
  trackId: string;
  kind: TrackKind;
  stream: MediaStream;
  store: ChunkStore;
  queue: UploadQueue;
  /** Defaults to the best supported type for `kind`. */
  mimeType?: string;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  /** MediaRecorder timeslice. Default 4000 ms. */
  timesliceMs?: number;
  /** Server-clock time in ms (see packages/sync). Defaults to Date.now. */
  now?: () => number;
  /** Non-fatal problems: a chunk that could not be persisted, an unexpected stop. */
  onError?: (err: unknown) => void;
  /** Stored with the track and handed back to the transport, also after a crash. */
  meta?: Record<string, string>;
  /** Injection point for tests. */
  MediaRecorder?: typeof MediaRecorder;
}

export type TrackRecorderState = "idle" | "recording" | "stopping" | "stopped";

/**
 * Records one MediaStream to the local chunk store and hands each chunk to
 * the upload queue. Chunks are written strictly in order: a chunk is queued
 * for upload only after it is durable locally.
 */
export class TrackRecorder {
  state: TrackRecorderState = "idle";
  mimeType = "";

  private opts: TrackRecorderOptions;
  private now: () => number;
  private recorder?: MediaRecorder;
  private info?: TrackInfo;
  private seq = 0;
  private lastTs = 0;
  private writes: Promise<void> = Promise.resolve();
  private finished?: Promise<CompletedTrack>;
  private releaseLock: () => void = () => {};

  constructor(opts: TrackRecorderOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  async start() {
    if (this.state !== "idle") throw new Error(`Cannot start a recorder in state "${this.state}"`);
    const { sessionId, trackId, kind, stream, store } = this.opts;
    const MR = this.opts.MediaRecorder ?? MediaRecorder;
    this.mimeType = this.opts.mimeType ?? pickMimeType(kind, (t) => MR.isTypeSupported(t));

    this.releaseLock = await holdLock(trackLockName(sessionId, trackId));
    const startedAt = this.now();
    this.info = { sessionId, trackId, kind, mimeType: this.mimeType, startedAt, ...(this.opts.meta && { meta: this.opts.meta }) };
    try {
      await store.putTrack(this.info);
    } catch (err) {
      this.releaseLock();
      throw err;
    }

    const recorder = new MR(stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: this.opts.videoBitsPerSecond,
      audioBitsPerSecond: this.opts.audioBitsPerSecond,
    });
    this.recorder = recorder;
    recorder.addEventListener("dataavailable", (e) => this.onData(e.data));
    recorder.addEventListener("error", (e) => this.opts.onError?.(e));
    this.finished = new Promise((resolve) =>
      recorder.addEventListener("stop", () => resolve(this.finalize()), { once: true }),
    );

    this.lastTs = startedAt;
    recorder.start(this.opts.timesliceMs ?? 4000);
    this.state = "recording";
  }

  /** Stops recording. Resolves once every chunk is durable locally (upload continues in the queue). */
  stop(): Promise<CompletedTrack> {
    if (!this.finished) return Promise.reject(new Error("Recorder was never started"));
    if (this.state === "recording") {
      this.state = "stopping";
      this.recorder!.stop();
    }
    return this.finished;
  }

  private onData(blob: Blob) {
    if (blob.size === 0) return;
    const endTs = this.now();
    const meta: ChunkMeta = {
      sessionId: this.opts.sessionId,
      trackId: this.opts.trackId,
      seq: this.seq++,
      startTs: this.lastTs,
      endTs,
      bytes: blob.size,
    };
    this.lastTs = endTs;
    this.writes = this.writes.then(() => this.persist(meta, blob));
  }

  private async persist(meta: ChunkMeta, blob: Blob) {
    const { store, queue, onError } = this.opts;
    let data: ArrayBuffer;
    try {
      data = await blob.arrayBuffer();
    } catch (err) {
      onError?.(new ChunkLostError(meta, err));
      return;
    }
    try {
      await store.putChunk(meta, data);
      queue.enqueue(meta);
    } catch (err) {
      // Disk full or storage evicted. Keep the chunk in memory and upload it
      // from there; it is lost only if the tab also dies before the upload.
      onError?.(new ChunkNotPersistedError(meta, err));
      queue.enqueue(meta, data);
    }
  }

  private async finalize(): Promise<CompletedTrack> {
    if (this.state === "recording") {
      // MediaRecorder stopped by itself: device unplugged, permission revoked, track ended.
      this.opts.onError?.(new Error("Recording stopped unexpectedly"));
    }
    await this.writes;
    const info: CompletedTrack = { ...this.info!, stoppedAt: this.now(), lastSeq: this.seq - 1 };
    try {
      await this.opts.store.putTrack(info);
    } catch (err) {
      // Not fatal: a later resume() treats the track as interrupted and still completes it.
      this.opts.onError?.(err);
    }
    this.opts.queue.finishTrack(info);
    this.releaseLock();
    this.state = "stopped";
    return info;
  }
}

export class ChunkNotPersistedError extends Error {
  constructor(
    readonly chunk: ChunkMeta,
    readonly cause: unknown,
  ) {
    super(`Chunk ${chunk.seq} of track ${chunk.trackId} could not be saved locally; uploading from memory`);
  }
}

export class ChunkLostError extends Error {
  constructor(
    readonly chunk: ChunkMeta,
    readonly cause: unknown,
  ) {
    super(`Chunk ${chunk.seq} of track ${chunk.trackId} could not be read from MediaRecorder`);
  }
}
