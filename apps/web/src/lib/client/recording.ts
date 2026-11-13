"use client";

import { videoTier, type VideoQuality } from "@tapry/shared";
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
} from "@tapry/recorder";
import type { SessionTicket } from "@tapry/shared";
import { loadTicket } from "./api";
import { getFilterPrefs, parseFilters, trackRegistered } from "./filters";
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
    await this.http(chunk.sessionId, info).uploadChunk(chunk, mimeType);
  }

  async completeTrack(info: CompletedTrack) {
    await this.register(info);
    await this.http(info.sessionId, info).completeTrack(info);
  }

  /** Idempotent on the server; memoized here so it runs once per track and page. */
  register(info: TrackInfo): Promise<void> {
    const key = `${info.sessionId}/${info.trackId}`;
    let p = this.registered.get(key);
    if (!p) {
      const request = trackRequest(info);
      p = this.post(info, `/tracks`, request)
        // Never part of the upload: it only lets a change of filters made meanwhile be sent again.
        .then(() => {
          try {
            trackRegistered(info.sessionId, request.filters);
          } catch {}
        })
        .catch((err) => {
        this.registered.delete(key); // let the queue's retry try again
        throw err;
      });
      this.registered.set(key, p);
    }
    return p;
  }

  private http(sessionId: string, info: TrackInfo | undefined) {
    const token = uploadToken(loadTicket(sessionId), info);
    return createHttpTransport({ baseUrl: "/api", headers: () => ({ authorization: `Bearer ${token}` }) });
  }

  private async post(info: TrackInfo, path: string, body: unknown) {
    const { sessionId } = info;
    const token = uploadToken(loadTicket(sessionId), info);
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (res.status === 410) throw new TrackGoneError("The host deleted this recording");
    if (!res.ok) throw new Error(`register track → ${res.status}`);
  }
}

/**
 * What registers a track with the server. `filters` are the person's when the track started
 * (kept with the track, so a track sent after a crash or a reload still says what it was
 * recorded with); tracks from before filters existed leave them out. The recording itself is
 * the untouched camera and mic either way: the server applies filters to the finished files.
 */
export function trackRequest(info: TrackInfo) {
  const filters = parseFilters(info.meta?.filters);
  return {
    trackId: info.trackId,
    recordingId: info.meta?.recordingId,
    kind: info.kind,
    mimeType: info.mimeType,
    startedAt: Math.round(info.startedAt),
    ...(filters && { filters }),
  };
}

/**
 * The token a track uploads with. A track belongs to whoever recorded it, and the browser keeps
 * one ticket per session, so someone who joins again as a new person would otherwise strand what
 * they recorded before. The current ticket wins for the same person: a host's token changes when
 * they reopen the studio.
 */
export function uploadToken(current: SessionTicket | null, info: TrackInfo | undefined) {
  const own = info?.meta;
  if (own?.token && own.participantId !== current?.participantId) return own.token;
  // The data stays on this device; it uploads once the ticket is back (rejoin via the link).
  if (!current) throw new Error(`No access to session ${info?.sessionId ?? ""} from this browser`);
  return current.token;
}

// ── Pipeline (one per page) ──────────────────────────────────────────────────

export interface Pipeline {
  store: ChunkStore;
  queue: UploadQueue;
  /**
   * Mask tracks (background blur) upload through their own queue over the same store: they
   * survive reloads and follow the same rules, but they never show in this person's upload
   * figures, hold back "all uploaded", or take an upload slot from the camera and mic.
   */
  maskQueue: UploadQueue;
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
    const maskQueue = new UploadQueue({ store, transport, concurrency: 1 });
    await queue.resume({ only: (t) => t.kind !== "mask" }).catch((err) => console.error("[recording] resume failed", err));
    // After the recording's own leftovers, and never in their way.
    void maskQueue.resume({ only: (t) => t.kind === "mask" }).catch((err) => console.warn("[recording] mask resume failed", err));
    return {
      store,
      queue,
      maskQueue,
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
  /** The problem reported through onError is over: chunks flow again, or a new track took over. */
  onRecovered?: () => void;
  /**
   * True while this device's recorders run, and until each has stopped and handed its last
   * chunk and completion to the upload queue. Stop on the server comes first: until this goes
   * false, an idle queue doesn't mean everything is sent.
   */
  onLocalActive?: (active: boolean) => void;
  /**
   * The mask track (background blur) couldn't be recorded. Never reported through onError: the
   * camera and mic are recording as they were. The app turns blur off and says so.
   */
  onMaskProblem?: (err: unknown) => void;
}

/** A mask is a small picture, a few frames a second: this is plenty. */
export const MASK_BITRATE = 150_000;

/** The recorder's video bitrate: the studio's tier, or in a 4K studio the tier of what this camera delivers. */
export const videoBitrate = (quality: VideoQuality, sourceHeight?: number | null) => videoTier(quality, sourceHeight).bitrate;
export const AUDIO_BITRATE = 128_000;
/** A recorder that keeps dying is reported, not restarted forever. */
const MAX_RESTARTS = 5;
const RESTART_DELAY_MS = 1000;

interface PlannedTrack {
  kind: TrackKind;
  stream: MediaStream;
  videoBitsPerSecond?: number;
}

/** Starts and stops this participant's local recorders as the host presses Record and Stop. */
export class RecordingController {
  private active: { recordingId: string; recorders: TrackRecorder[]; restarts: number; hasVideo: boolean; mask?: TrackRecorder; maskOf?: MediaStream } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  /** Where the person is, as a video to record beside the camera; null when blur is off or not ready. */
  private maskStream: MediaStream | null = null;

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

  /**
   * Background blur's mask became available (record it beside the camera, from now on) or went
   * away (stop recording it). Nothing here can fail the camera and mic recorders: a problem only
   * reaches onMaskProblem.
   */
  setMask(stream: MediaStream | null) {
    this.maskStream = stream;
    this.chain = this.chain
      .then(async () => {
        const active = this.active;
        if (!active) return;
        if (stream && active.maskOf !== stream) {
          this.stopMask(active);
          await this.startMask(active);
        } else if (!stream) this.stopMask(active);
      })
      .catch((err) => this.opts.onMaskProblem?.(err));
    return this.chain;
  }

  /** Records the mask as a third, small track of this recording. Never throws. */
  private async startMask(active: NonNullable<RecordingController["active"]>) {
    const stream = this.maskStream;
    if (!stream || !active.hasVideo || active.mask || this.active !== active) return;
    const { ticket, clockOffsetMs, onMaskProblem } = this.opts;
    try {
      const { store, maskQueue, transport } = await getPipeline();
      const trackId = newTrackId();
      const recorder: TrackRecorder = new TrackRecorder({
        sessionId: ticket.sessionId,
        trackId,
        kind: "mask",
        stream,
        store,
        queue: maskQueue,
        mimeType: pickMimeType("mask"),
        videoBitsPerSecond: MASK_BITRATE,
        // The same clock as the camera's track, so the worker can lay one over the other.
        now: () => Math.round(localNow() + clockOffsetMs),
        meta: trackMeta(ticket, active.recordingId),
        // A still picture can encode to nothing for a while: that isn't a stalled recording.
        stallMs: 0,
        onError: (err) => console.warn("[recording] mask", err),
        onUnexpectedStop: () => {
          if (active.mask !== recorder) return;
          active.mask = active.maskOf = undefined;
          onMaskProblem?.(new Error("The mask recorder stopped"));
        },
      });
      active.mask = recorder;
      active.maskOf = stream;
      await recorder.start();
      const info = await store.getTrack(ticket.sessionId, trackId);
      if (info) transport.register(info).catch(() => {});
    } catch (err) {
      active.mask = active.maskOf = undefined;
      onMaskProblem?.(err);
    }
  }

  /** Stops the mask's recorder; what it recorded uploads and completes like any track. */
  private stopMask(active: NonNullable<RecordingController["active"]>) {
    const mask = active.mask;
    active.mask = active.maskOf = undefined;
    if (mask) void mask.stop().catch(() => {});
  }

  private async start(recordingId: string) {
    const { ticket, stream } = this.opts;
    const audio = stream.getAudioTracks()[0];
    const video = stream.getVideoTracks()[0];
    const plan: PlannedTrack[] = [];
    // Audio on its own: the clean track podcasters edit with.
    if (audio) plan.push({ kind: "audio", stream: new MediaStream([audio]) });
    // Camera with sound, so the video file is usable on its own too.
    if (video) plan.push({ kind: "video", stream, videoBitsPerSecond: videoBitrate(ticket.studio.settings.videoQuality, video.getSettings().height) });

    const active: NonNullable<RecordingController["active"]> = { recordingId, recorders: [], restarts: 0, hasVideo: !!video };
    this.active = active;
    this.opts.onLocalActive?.(true);
    const trackIds: string[] = [];
    for (const p of plan) trackIds.push(await this.startTrack(active, p));
    // With background blur on: the mask, from the same moment as the camera (it can't throw).
    await this.startMask(active);
    await this.register(trackIds);
  }

  private async startTrack(active: NonNullable<RecordingController["active"]>, p: PlannedTrack) {
    const { ticket, clockOffsetMs } = this.opts;
    const { store, queue } = await getPipeline();
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
      // The same clock the offset was measured on (Date.now() can jump if the system clock is
      // adjusted), in whole milliseconds like every timestamp the server takes.
      now: () => Math.round(localNow() + clockOffsetMs),
      meta: trackMeta(ticket, active.recordingId),
      onError: this.opts.onError,
      onRecovered: this.opts.onRecovered,
      onUnexpectedStop: () => this.restart(active, p),
    });
    await recorder.start();
    active.recorders.push(recorder);
    return trackId;
  }

  /**
   * A recorder stopped by itself mid-recording: carry on in a new track, which processing merges
   * with the first. Not possible when the device itself is gone; the alert stays up then.
   */
  private restart(active: NonNullable<RecordingController["active"]>, p: PlannedTrack) {
    this.chain = this.chain
      .then(async () => {
        await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
        if (this.active !== active || active.restarts >= MAX_RESTARTS) return;
        if (!p.stream.getTracks().every((t) => t.readyState === "live")) return;
        active.restarts++;
        await this.register([await this.startTrack(active, p)]);
        this.opts.onRecovered?.();
      })
      .catch(this.opts.onError);
  }

  /** Register right away when online, so the host sees the tracks; failures retry with the upload. */
  private async register(trackIds: string[]) {
    const { store, transport } = await getPipeline();
    for (const trackId of trackIds) {
      const info = await store.getTrack(this.opts.ticket.sessionId, trackId);
      if (info) transport.register(info).catch(() => {});
    }
  }

  private async stopActive() {
    const active = this.active;
    if (!active) return;
    this.active = null;
    this.stopMask(active); // not waited for: the mask never holds up the real tracks
    try {
      await Promise.all(active.recorders.map((r) => r.stop()));
    } finally {
      this.opts.onLocalActive?.(false);
    }
  }
}

/** What is kept with each track on the device: which recording, whose, and their filters at the time. */
function trackMeta(ticket: SessionTicket, recordingId: string): Record<string, string> {
  return {
    recordingId,
    participantId: ticket.participantId,
    token: ticket.token,
    // Only noted for the server; the recorder gets the plain stream, as always.
    filters: JSON.stringify(getFilterPrefs().filters),
  };
}

function newTrackId() {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return `trk_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
