import { isLockHeld, legacyTrackLockName, trackLockName } from "./locks.js";
import { isTrackGone, type ChunkMeta, type ChunkStore, type ChunkTransport, type CompletedTrack, type StoredChunk, type TrackInfo } from "./types.js";

export interface UploadProgress {
  /** Chunks waiting or uploading. */
  pendingChunks: number;
  pendingBytes: number;
  uploadedChunks: number;
  uploadedBytes: number;
  /** endTs of the oldest chunk not yet uploaded, or null when caught up. Drives "X min behind". */
  oldestPendingTs: number | null;
  /** Stopped tracks whose completion the server has not confirmed yet. */
  pendingTracks: number;
  lastError: unknown;
  idle: boolean;
}

export interface UploadQueueOptions {
  store: ChunkStore;
  transport: ChunkTransport;
  /** Parallel uploads. Default 3. */
  concurrency?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  onProgress?: (p: UploadProgress) => void;
  /** Wall clock for retry scheduling (not the server clock). */
  now?: () => number;
  random?: () => number;
}

interface ChunkJob {
  meta: ChunkMeta;
  attempts: number;
  notBefore: number;
  /** Only set when the local store failed to persist this chunk. */
  memoryData?: ArrayBuffer;
}

interface TrackJob {
  info: CompletedTrack;
  attempts: number;
  notBefore: number;
}

/**
 * Uploads chunks from the local store and deletes each one only after the
 * transport confirms it. Failures retry forever with capped exponential
 * backoff: the data stays on disk, so giving up would only lose it. The one
 * exception is TrackGoneError (the recording was deleted): that track is dropped.
 */
export class UploadQueue {
  private store: ChunkStore;
  private transport: ChunkTransport;
  private concurrency: number;
  private retryBaseMs: number;
  private retryMaxMs: number;
  private now: () => number;
  private random: () => number;
  private onProgress?: (p: UploadProgress) => void;

  private waiting = new Map<string, ChunkJob>();
  private uploading = new Map<string, ChunkJob>();
  private tracksWaiting = new Map<string, TrackJob>();
  private tracksCompleting = new Set<string>();
  private mimeTypes = new Map<string, string>();
  /** Tracks the server said it will never take (TrackGoneError). */
  private gone = new Set<string>();
  private uploadedChunks = 0;
  private uploadedBytes = 0;
  private lastError: unknown = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private idleWaiters: Array<() => void> = [];
  private closed = false;
  private onOnline = () => this.retryNow();

  constructor(opts: UploadQueueOptions) {
    this.store = opts.store;
    this.transport = opts.transport;
    this.concurrency = opts.concurrency ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.retryMaxMs = opts.retryMaxMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.onProgress = opts.onProgress;
    globalThis.addEventListener?.("online", this.onOnline);
  }

  /** Queue a chunk already in the store, or pass `memoryData` if storing it failed. */
  enqueue(meta: ChunkMeta, memoryData?: ArrayBuffer) {
    const key = chunkKey(meta);
    if (this.waiting.has(key) || this.uploading.has(key)) return;
    if (this.gone.has(trackKey(meta.sessionId, meta.trackId))) return;
    this.waiting.set(key, { meta, attempts: 0, notBefore: 0, memoryData });
    this.pump();
  }

  /** Tell the server the track is complete once all of its chunks are uploaded. */
  finishTrack(info: CompletedTrack) {
    const key = trackKey(info.sessionId, info.trackId);
    if (this.gone.has(key)) return;
    this.mimeTypes.set(key, info.mimeType);
    if (!this.tracksCompleting.has(key)) this.tracksWaiting.set(key, { info, attempts: 0, notBefore: 0 });
    this.pump();
  }

  /**
   * Re-queue everything left in the store by a previous page load (crash,
   * closed tab, reload). Tracks still held by a live recorder in another tab
   * are skipped. Tracks that never reached stop() are completed as interrupted.
   * `only` picks the tracks this queue takes, when several queues share one store (for example
   * one for the recording and one for its helper tracks, so each reports its own progress).
   */
  async resume(opts: { only?: (track: TrackInfo) => boolean } = {}) {
    for (const track of await this.store.listTracks()) {
      if (opts.only && !opts.only(track)) continue;
      if (await isLockHeld(trackLockName(track.sessionId, track.trackId))) continue;
      if (await isLockHeld(legacyTrackLockName(track.sessionId, track.trackId))) continue;
      const key = trackKey(track.sessionId, track.trackId);
      this.mimeTypes.set(key, track.mimeType);
      const chunks = await this.store.listChunks(track.sessionId, track.trackId);
      for (const meta of chunks) this.enqueue(meta);

      if (track.stoppedAt !== undefined) {
        this.finishTrack({ ...track, stoppedAt: track.stoppedAt, lastSeq: track.lastSeq ?? null });
      } else {
        const last = chunks.at(-1);
        const info: CompletedTrack = {
          ...track,
          stoppedAt: last?.endTs ?? track.startedAt,
          lastSeq: null,
          interrupted: true,
        };
        await this.store.putTrack(info);
        this.finishTrack(info);
      }
    }
  }

  /** Skip backoff and retry everything now (called automatically on the `online` event). */
  retryNow() {
    for (const job of this.waiting.values()) job.notBefore = 0;
    for (const job of this.tracksWaiting.values()) job.notBefore = 0;
    this.pump();
  }

  /** Resolves when every queued chunk and track completion has been confirmed. */
  drain(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  progress(): UploadProgress {
    let pendingBytes = 0;
    let oldestPendingTs: number | null = null;
    for (const job of [...this.waiting.values(), ...this.uploading.values()]) {
      pendingBytes += job.meta.bytes;
      if (oldestPendingTs === null || job.meta.endTs < oldestPendingTs) oldestPendingTs = job.meta.endTs;
    }
    return {
      pendingChunks: this.waiting.size + this.uploading.size,
      pendingBytes,
      uploadedChunks: this.uploadedChunks,
      uploadedBytes: this.uploadedBytes,
      oldestPendingTs,
      pendingTracks: this.tracksWaiting.size + this.tracksCompleting.size,
      lastError: this.lastError,
      idle: this.isIdle(),
    };
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    globalThis.removeEventListener?.("online", this.onOnline);
  }

  private pump() {
    if (this.closed) return;
    clearTimeout(this.timer);
    const now = this.now();

    while (this.uploading.size < this.concurrency) {
      const next = this.nextReadyChunk(now);
      if (!next) break;
      const [key, job] = next;
      this.waiting.delete(key);
      this.uploading.set(key, job);
      void this.uploadChunk(key, job);
    }

    for (const [key, job] of this.tracksWaiting) {
      if (job.notBefore > now || this.hasChunksFor(key)) continue;
      this.tracksWaiting.delete(key);
      this.tracksCompleting.add(key);
      void this.completeTrack(key, job);
    }

    const wakeAt = Math.min(
      ...[...this.waiting.values(), ...this.tracksWaiting.values()].map((j) => j.notBefore).filter((t) => t > now),
    );
    if (Number.isFinite(wakeAt)) this.timer = setTimeout(() => this.pump(), wakeAt - now);

    this.onProgress?.(this.progress());
    if (this.isIdle()) for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  private async uploadChunk(key: string, job: ChunkJob) {
    const { sessionId, trackId, seq } = job.meta;
    try {
      const chunk: StoredChunk | undefined = job.memoryData
        ? { ...job.meta, data: job.memoryData }
        : await this.store.getChunk(sessionId, trackId, seq);
      if (chunk) {
        await this.transport.uploadChunk(chunk, await this.mimeTypeFor(sessionId, trackId));
        this.uploadedChunks++;
        this.uploadedBytes += chunk.bytes;
        if (!job.memoryData) await this.deleteQuietly(sessionId, trackId, seq);
      }
      // No chunk: another tab's recovery already uploaded and deleted it.
      this.uploading.delete(key);
    } catch (err) {
      this.uploading.delete(key);
      if (isTrackGone(err)) await this.dropTrack(sessionId, trackId);
      else if (!this.gone.has(trackKey(sessionId, trackId))) {
        this.lastError = err;
        this.waiting.set(key, this.backoff(job));
      }
    }
    this.pump();
  }

  private async completeTrack(key: string, job: TrackJob) {
    try {
      await this.transport.completeTrack(job.info);
      await this.store.deleteTrack(job.info.sessionId, job.info.trackId).catch((err) => (this.lastError = err));
    } catch (err) {
      if (isTrackGone(err)) await this.dropTrack(job.info.sessionId, job.info.trackId);
      else {
        this.lastError = err;
        this.tracksWaiting.set(key, this.backoff(job));
      }
    }
    this.tracksCompleting.delete(key);
    this.pump();
  }

  /** The server will never take this track: forget it here and delete it from the local store. */
  private async dropTrack(sessionId: string, trackId: string) {
    const key = trackKey(sessionId, trackId);
    this.gone.add(key);
    for (const k of [...this.waiting.keys()]) if (k.startsWith(key + "\u0000")) this.waiting.delete(k);
    this.tracksWaiting.delete(key);
    // If this fails, the next page load finds the track again and the server says 410 again.
    await this.store.deleteTrack(sessionId, trackId).catch((err) => (this.lastError = err));
  }

  private async deleteQuietly(sessionId: string, trackId: string, seq: number) {
    // The server has it. If the local delete fails the chunk is simply
    // uploaded again on the next resume, which is safe (uploads are idempotent).
    await this.store.deleteChunk(sessionId, trackId, seq).catch((err) => (this.lastError = err));
  }

  private async mimeTypeFor(sessionId: string, trackId: string) {
    const key = trackKey(sessionId, trackId);
    let mime = this.mimeTypes.get(key);
    if (!mime) {
      mime = (await this.store.getTrack(sessionId, trackId))?.mimeType ?? "application/octet-stream";
      this.mimeTypes.set(key, mime);
    }
    return mime;
  }

  private backoff<J extends { attempts: number; notBefore: number }>(job: J): J {
    const attempts = job.attempts + 1;
    const delay = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** (attempts - 1)) * (0.5 + this.random() * 0.5);
    return { ...job, attempts, notBefore: this.now() + delay };
  }

  /** Oldest ready chunk first, so the server-side recording fills in from the start. */
  private nextReadyChunk(now: number): [string, ChunkJob] | undefined {
    let best: [string, ChunkJob] | undefined;
    for (const entry of this.waiting) {
      if (entry[1].notBefore > now) continue;
      if (!best || entry[1].meta.endTs < best[1].meta.endTs) best = entry;
    }
    return best;
  }

  private hasChunksFor(trackKeyPrefix: string) {
    const prefix = trackKeyPrefix + "\u0000";
    for (const key of this.waiting.keys()) if (key.startsWith(prefix)) return true;
    for (const key of this.uploading.keys()) if (key.startsWith(prefix)) return true;
    return false;
  }

  private isIdle() {
    return (
      this.waiting.size === 0 &&
      this.uploading.size === 0 &&
      this.tracksWaiting.size === 0 &&
      this.tracksCompleting.size === 0
    );
  }
}

const trackKey = (sessionId: string, trackId: string) => `${sessionId}\u0000${trackId}`;
const chunkKey = (m: ChunkMeta) => `${trackKey(m.sessionId, m.trackId)}\u0000${m.seq}`;
