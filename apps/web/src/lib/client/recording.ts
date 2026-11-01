"use client";

import {
  createHttpTransport,
  IndexedDBChunkStore,
  MemoryChunkStore,
  pickMimeType,
  TrackGoneError,
  TrackRecorder,
  UploadQueue,
  type ChunkStore,
  type ChunkTransport,
  type CompletedTrack,
  type StoredChunk,
  type TrackInfo,
  type TrackKind,
  type UploadProgress,
} from "@opentake/recorder";
import type { SessionTicket } from "@opentake/shared";
import { loadTicket } from "./api";
import { localNow } from "./clock";

// ── Transport ────────────────────────────────────────────────────────────────

/**
 * Uploads with the right participant token for each chunk's session (leftovers from an
 * earlier session upload with that session's ticket), and registers each track with the
 * server before its first chunk. Registration is lazy and retried by the queue, so a
 * guest who is offline when Record is pressed still records and catches up later.
 */
class AppTransport implements ChunkTransport {
  private registered = new Map<string, Promise<void>>();

  constructor(private store: ChunkStore) {}

  async uploadChunk(chunk: StoredChunk, mimeType: string) {
    const info = await this.store.getTrack(chunk.sessionId, chunk.trackId);
    if (info) await this.register(info);
    await this.http(chunk.sessionId).uploadChunk(chunk, mimeType);
  }

  async completeTrack(info: CompletedTrack) {
    await this.register(info);
    await this.http(info.sessionId).completeTrack(info);
  }

  /** Idempotent on the server; memoized here so it runs once per track and page. */
  register(info: TrackInfo): Promise<void> {
    const key = `${info.sessionId}/${info.trackId}`;
    let p = this.registered.get(key);
    if (!p) {
      p = this.post(info.sessionId, `/tracks`, {
        trackId: info.trackId,
        recordingId: info.meta?.recordingId,
        kind: info.kind,
        mimeType: info.mimeType,
        startedAt: Math.round(info.startedAt),
      }).catch((err) => {
        this.registered.delete(key); // let the queue's retry try again
        throw err;
      });
      this.registered.set(key, p);
    }
    return p;
  }

  private ticket(sessionId: string): SessionTicket {
    const ticket = loadTicket(sessionId);
    // The data stays on this device; it uploads once the ticket is back (rejoin via the link).
    if (!ticket) throw new Error(`No access to session ${sessionId} from this browser`);
    return ticket;
  }

  private http(sessionId: string) {
    const { token } = this.ticket(sessionId);
    return createHttpTransport({ baseUrl: "/api", headers: () => ({ authorization: `Bearer ${token}` }) });
  }

  private async post(sessionId: string, path: string, body: unknown) {
    const { token } = this.ticket(sessionId);
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (res.status === 410) throw new TrackGoneError("The host deleted this recording");
    if (!res.ok) throw new Error(`register track → ${res.status}`);
  }
}

// ── Pipeline (one per page) ──────────────────────────────────────────────────

export interface Pipeline {
  store: ChunkStore;
  queue: UploadQueue;
  transport: AppTransport;
  /** False when IndexedDB was unavailable and chunks only live in memory. */
  durable: boolean;
  subscribe(fn: (p: UploadProgress) => void): () => void;
}

let pipeline: Promise<Pipeline> | undefined;

/**
 * The local chunk store and upload queue for this page. On first use it also resumes
 * anything an earlier page load left behind (crash, closed tab, reload).
 */
export function getPipeline(): Promise<Pipeline> {
  pipeline ??= (async () => {
    let store: ChunkStore;
    let durable = true;
    try {
      store = await IndexedDBChunkStore.open();
    } catch {
      store = new MemoryChunkStore();
      durable = false;
    }
    const listeners = new Set<(p: UploadProgress) => void>();
    const transport = new AppTransport(store);
    const queue = new UploadQueue({ store, transport, onProgress: (p) => listeners.forEach((fn) => fn(p)) });
    await queue.resume().catch((err) => console.error("[recording] resume failed", err));
    return {
      store,
      queue,
      transport,
      durable,
      subscribe(fn) {
        listeners.add(fn);
        fn(queue.progress());
        return () => listeners.delete(fn);
      },
    };
  })();
  return pipeline;
}

// ── Recording controller ─────────────────────────────────────────────────────

export interface RecordingOptions {
  ticket: SessionTicket;
  stream: MediaStream;
  /** Add to localNow() to get server time (from the green room's clock estimate). */
  clockOffsetMs: number;
  onError: (err: unknown) => void;
  /**
   * True while this device's recorders run, and until each has stopped and handed its last
   * chunk and completion to the upload queue. Stop on the server comes first: until this goes
   * false, an idle queue doesn't mean everything is sent.
   */
  onLocalActive?: (active: boolean) => void;
}

const VIDEO_BITRATE = { "1080p": 8_000_000, "720p": 4_000_000 } as const;
const AUDIO_BITRATE = 128_000;

/** Starts and stops this participant's local recorders as the host presses Record and Stop. */
export class RecordingController {
  private active: { recordingId: string; recorders: TrackRecorder[] } | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private opts: RecordingOptions) {}

  get recordingId() {
    return this.active?.recordingId ?? null;
  }

  /** Follow the session's recording state. Calls are serialized; repeats are no-ops. */
  sync(recordingId: string | null) {
    this.chain = this.chain
      .then(async () => {
        if (this.active?.recordingId === recordingId) return;
        await this.stopActive();
        if (recordingId) await this.start(recordingId);
      })
      .catch(this.opts.onError);
    return this.chain;
  }

  stop() {
    return this.sync(null);
  }

  private async start(recordingId: string) {
    const { ticket, stream, clockOffsetMs } = this.opts;
    const { store, queue, transport } = await getPipeline();
    // The same clock the offset was measured on (Date.now() can jump if the system clock is
    // adjusted), in whole milliseconds like every timestamp the server takes.
    const now = () => Math.round(localNow() + clockOffsetMs);

    const audio = stream.getAudioTracks()[0];
    const video = stream.getVideoTracks()[0];
    const plan: Array<{ kind: TrackKind; stream: MediaStream; videoBitsPerSecond?: number }> = [];
    // Audio on its own: the clean track podcasters edit with.
    if (audio) plan.push({ kind: "audio", stream: new MediaStream([audio]) });
    // Camera with sound, so the video file is usable on its own too.
    if (video) plan.push({ kind: "video", stream, videoBitsPerSecond: VIDEO_BITRATE[ticket.studio.settings.videoQuality] });

    const recorders: TrackRecorder[] = [];
    const trackIds: string[] = [];
    this.active = { recordingId, recorders };
    this.opts.onLocalActive?.(true);
    for (const p of plan) {
      const trackId = newTrackId();
      const recorder = new TrackRecorder({
        sessionId: ticket.sessionId,
        trackId,
        kind: p.kind,
        stream: p.stream,
        store,
        queue,
        mimeType: pickMimeType(p.kind),
        videoBitsPerSecond: p.videoBitsPerSecond,
        audioBitsPerSecond: AUDIO_BITRATE,
        now,
        meta: { recordingId },
        onError: this.opts.onError,
      });
      await recorder.start();
      recorders.push(recorder);
      trackIds.push(trackId);
    }
    // Register right away when online, so the host sees the tracks; failures retry with the upload.
    for (const trackId of trackIds) {
      const info = await store.getTrack(ticket.sessionId, trackId);
      if (info) transport.register(info).catch(() => {});
    }
  }

  private async stopActive() {
    const active = this.active;
    if (!active) return;
    this.active = null;
    try {
      await Promise.all(active.recorders.map((r) => r.stop()));
    } finally {
      this.opts.onLocalActive?.(false);
    }
  }
}

function newTrackId() {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return `trk_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
