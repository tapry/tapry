"use client";

// In-call quality alerts, worked out on each person's own device from what it can measure:
// the mic's level, the upload queue, browser storage and the tab. Only the alert codes and the
// upload lag leave the device (POST .../telemetry); never audio, video or text.
import { checkStorage, type UploadProgress } from "@tapry/recorder";
import type { QualityAlert, SessionState, SessionTicket } from "@tapry/shared";
import { useEffect, useRef, useState } from "react";
import { measureLevel } from "@/lib/media/media";
import { localNow } from "./clock";

/** Peak at or above this counts as clipping: -1 dBFS. */
export const CLIP_LEVEL = 0.891;
/** More than this many clips within CLIP_WINDOW_MS: alert. */
export const CLIPS_TO_ALERT = 3;
export const CLIP_WINDOW_MS = 10_000;
/** Below -55 dBFS the whole time for this long while unmuted: the mic is dead or wrong. */
export const SILENT_LEVEL = 0.0018;
export const SILENT_AFTER_MS = 30_000;
/**
 * Voice activity: a reading counts as talking when its RMS is this far above the room's noise
 * floor (the 10th percentile of the last NOISE_WINDOW_MS) and above SPEECH_MIN_DB.
 */
export const SPEECH_ABOVE_FLOOR_DB = 12;
export const SPEECH_MIN_DB = -55;
export const NOISE_WINDOW_MS = 15_000;
/** Gaps between words: talking carries on this long after the last speech reading. */
export const SPEECH_HANGOVER_MS = 400;
/** Too quiet: at least QUIET_MIN_TALK_MS of talking in the last QUIET_WINDOW_MS, none of it reaching QUIET_LEVEL_DB (the green room's "quiet" line). */
export const QUIET_WINDOW_MS = 30_000;
export const QUIET_MIN_TALK_MS = 5_000;
export const QUIET_LEVEL_DB = -38;
/** Talk balance: nudge the host once they've done this share of the talking, after TALK_NUDGE_AFTER_MS of it in all. */
export const TALK_NUDGE_SHARE = 0.7;
export const TALK_NUDGE_AFTER_MS = 120_000;
/**
 * Echo: over the last ECHO_WINDOW_MS, with the others talking for at least ECHO_MIN_FAR_MS, the
 * mic's level follows the call's level (correlation at least ECHO_CORRELATION at a delay of up
 * to ECHO_MAX_LAG readings, about 300 ms). People take turns, so without echo the two levels
 * move apart, not together. The mic must follow, not lead: someone whose own voice comes back
 * from another person's speakers sees the same likeness the other way round (their mic first,
 * the call up to a round trip later, ECHO_RETURN_LAG readings) and doesn't have the echo.
 */
export const ECHO_WINDOW_MS = 20_000;
export const ECHO_MIN_FAR_MS = 5_000;
export const ECHO_CORRELATION = 0.6;
export const ECHO_MAX_LAG = 3;
export const ECHO_RETURN_LAG = 6;
/** Upload lag (oldest unsent chunk) before alerting. */
export const UPLOAD_BEHIND_AFTER_S = 60;
/** Less browser storage than this: alert (the green room asks for 2 GB). */
export const LOW_DISK_BYTES = 1024 ** 3;

/**
 * The mic part, kept apart from the browser so it can be tested: feed it readings (peak 0–1 and
 * RMS in dBFS) with their times, ask which alerts hold now and how long the person has talked.
 */
export class MicAlerts {
  private clips: number[] = [];
  private lastHeard: number;
  private levels: Array<{ t: number; rmsDb: number }> = [];
  /** Readings that counted as talking, for the too-quiet check. */
  private speech: Array<{ t: number; ms: number; rmsDb: number }> = [];
  private lastSpeech = -Infinity;
  private lastReading: number | null = null;
  /** Talking time since resetTalk(), counted only while counting is on. */
  talkMs = 0;

  constructor(now: number) {
    this.lastHeard = now;
  }

  /** One measurement: the loudest sample and the RMS of a block read now. */
  addLevel(peak: number, rmsDb: number, now: number, countTalk = false) {
    if (peak >= CLIP_LEVEL) this.clips.push(now);
    if (peak >= SILENT_LEVEL) this.lastHeard = now;

    this.levels.push({ t: now, rmsDb });
    while (this.levels[0]!.t < now - NOISE_WINDOW_MS) this.levels.shift();
    const sorted = this.levels.map((l) => l.rmsDb).sort((a, b) => a - b);
    const floorDb = sorted[Math.floor(sorted.length / 10)]!;
    const ms = this.lastReading === null ? 0 : Math.min(now - this.lastReading, 500);
    this.lastReading = now;
    if (rmsDb >= Math.max(floorDb + SPEECH_ABOVE_FLOOR_DB, SPEECH_MIN_DB)) {
      this.lastSpeech = now;
      this.speech.push({ t: now, ms, rmsDb });
    }
    while (this.speech.length && this.speech[0]!.t < now - QUIET_WINDOW_MS) this.speech.shift();
    if (countTalk && now - this.lastSpeech <= SPEECH_HANGOVER_MS) this.talkMs += ms;
  }

  /** A new recording: count its talk time from zero. */
  resetTalk() {
    this.talkMs = 0;
  }

  /** Muting is silence on purpose: start the silence clock again from now. */
  reset(now: number) {
    this.lastHeard = now;
  }

  alerts(now: number, muted: boolean): QualityAlert[] {
    this.clips = this.clips.filter((t) => now - t <= CLIP_WINDOW_MS);
    const out: QualityAlert[] = [];
    if (this.clips.length > CLIPS_TO_ALERT) out.push("clipping");
    if (!muted && now - this.lastHeard >= SILENT_AFTER_MS) out.push("mic_silent");
    const talked = this.speech.reduce((sum, s) => sum + s.ms, 0);
    if (!muted && talked >= QUIET_MIN_TALK_MS && this.speech.every((s) => s.rmsDb < QUIET_LEVEL_DB)) out.push("too_quiet");
    return out;
  }
}

const percentile10 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 10)]!;

function correlation(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/**
 * Echo, from two levels read together: what the call plays (everyone else, mixed) and what the
 * mic records. Kept apart from the browser so it can be tested.
 */
export class EchoDetector {
  private readings: Array<{ t: number; ms: number; farDb: number; nearDb: number }> = [];

  add(farDb: number, nearDb: number, now: number) {
    const last = this.readings.at(-1);
    this.readings.push({ t: now, ms: last ? Math.min(now - last.t, 500) : 0, farDb, nearDb });
    while (this.readings[0]!.t < now - ECHO_WINDOW_MS) this.readings.shift();
  }

  /** No call audio (nobody else, or the call dropped): start again. */
  clear() {
    this.readings = [];
  }

  echo(): boolean {
    const r = this.readings;
    if (r.length < 20) return false;
    const farFloor = percentile10(r.map((x) => x.farDb));
    const nearFloor = percentile10(r.map((x) => x.nearDb));
    const farTalk = r.filter((x) => x.farDb >= Math.max(farFloor + SPEECH_ABOVE_FLOOR_DB, SPEECH_MIN_DB));
    if (farTalk.reduce((sum, x) => sum + x.ms, 0) < ECHO_MIN_FAR_MS) return false;
    // Levels at or under each side's noise floor all count as the floor: hiss isn't a signal.
    const far = r.map((x) => Math.max(x.farDb, farFloor));
    const near = r.map((x) => Math.max(x.nearDb, nearFloor));
    // Positive lag: the mic `lag` readings after the call. Negative: the mic first.
    const at = (lag: number) =>
      lag >= 0 ? correlation(far.slice(0, far.length - lag), near.slice(lag)) : correlation(far.slice(-lag), near.slice(0, near.length + lag));
    let follows = -1;
    for (let lag = 0; lag <= ECHO_MAX_LAG; lag++) follows = Math.max(follows, at(lag));
    let leads = -1;
    for (let lag = 1; lag <= ECHO_RETURN_LAG; lag++) leads = Math.max(leads, at(-lag));
    return follows >= ECHO_CORRELATION && follows > leads;
  }
}

/** Seconds the upload is behind (oldest unsent chunk's age), or null when caught up. */
export function uploadBehindS(upload: UploadProgress | null, serverNow: number): number | null {
  if (!upload || upload.oldestPendingTs === null) return null;
  return Math.max(0, Math.round((serverNow - upload.oldestPendingTs) / 1000));
}

export interface QualityInputs {
  ticket: SessionTicket;
  stream: MediaStream;
  upload: UploadProgress | null;
  micMuted: boolean;
  headphones: boolean;
  recorderError: string | null;
  clockOffsetMs: number;
  /** What the call plays from everyone else (for the echo check); empty without a call. */
  callAudio: MediaStreamTrack[];
  /** The recording in progress, if any: talk time is counted while it runs. */
  recordingId: string | null;
  /** False once the session ended: stop measuring and reporting. */
  active: boolean;
}

const REPORT_EVERY_MS = 3_000;
const LEVEL_EVERY_MS = 100;
const DISK_EVERY_MS = 30_000;

/** This device's current alerts, also reported to the server for the host. */
export function useQualityAlerts(q: QualityInputs) {
  const [alerts, setAlerts] = useState<QualityAlert[]>([]);
  const [behindS, setBehindS] = useState<number | null>(null);
  const latest = useRef(q);
  latest.current = q;

  useEffect(() => {
    if (!q.active) return;
    let cancelled = false;
    const mic = new MicAlerts(Date.now());
    let lowDisk = false;
    let lastSent = "";
    let lastSentAt = 0;

    // Mic level from the same stream the recorder uses (reading it changes nothing).
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    const track = q.stream.getAudioTracks()[0];
    if (track && typeof AudioContext !== "undefined") {
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      void ctx.resume().catch(() => {});
    }
    const buf = new Float32Array(2048);
    // The call's sound, everyone mixed into one analyser, re-wired as people come and go.
    const echo = new EchoDetector();
    const farAnalyser = ctx?.createAnalyser();
    if (farAnalyser) farAnalyser.fftSize = 2048;
    const farSources = new Map<string, MediaStreamAudioSourceNode>();
    const farBuf = new Float32Array(2048);
    const syncFarSources = () => {
      if (!ctx || !farAnalyser) return;
      const tracks = latest.current.callAudio.filter((t) => t.readyState === "live");
      for (const [id, source] of farSources) {
        if (!tracks.some((t) => t.id === id)) {
          source.disconnect();
          farSources.delete(id);
        }
      }
      for (const t of tracks) {
        if (farSources.has(t.id)) continue;
        const source = ctx.createMediaStreamSource(new MediaStream([t]));
        source.connect(farAnalyser);
        farSources.set(t.id, source);
      }
    };
    let talkFor: string | null = null;
    const levelTimer = setInterval(() => {
      const recordingId = latest.current.recordingId;
      if (recordingId && recordingId !== talkFor) mic.resetTalk();
      if (recordingId) talkFor = recordingId;
      // A suspended context (no click yet) reads silence: don't call that a dead mic.
      if (!analyser || ctx?.state !== "running") return mic.reset(Date.now());
      analyser.getFloatTimeDomainData(buf);
      const { rmsDb, peakDb } = measureLevel(buf);
      mic.addLevel(10 ** (peakDb / 20), rmsDb, Date.now(), !!recordingId && !latest.current.micMuted);
      syncFarSources();
      if (farSources.size === 0 || latest.current.micMuted) return echo.clear();
      farAnalyser!.getFloatTimeDomainData(farBuf);
      echo.add(measureLevel(farBuf).rmsDb, rmsDb, Date.now());
    }, LEVEL_EVERY_MS);

    const checkDisk = () =>
      checkStorage(LOW_DISK_BYTES)
        .then((s) => (lowDisk = !s.ok))
        .catch(() => {});
    void checkDisk();
    const diskTimer = setInterval(checkDisk, DISK_EVERY_MS);

    let wasMuted = latest.current.micMuted;
    const evaluate = () => {
      if (cancelled) return;
      const cur = latest.current;
      const now = Date.now();
      if (cur.micMuted !== wasMuted) {
        mic.reset(now);
        wasMuted = cur.micMuted;
      }
      const behind = uploadBehindS(cur.upload, localNow() + cur.clockOffsetMs);
      const list: QualityAlert[] = [...mic.alerts(now, cur.micMuted)];
      if (echo.echo()) list.push("echo");
      if (behind !== null && behind >= UPLOAD_BEHIND_AFTER_S) list.push("upload_behind");
      if (lowDisk) list.push("low_disk");
      if (document.visibilityState === "hidden") list.push("tab_hidden");
      if (cur.recorderError) list.push("recorder_error");
      if (!cur.headphones && cur.stream.getAudioTracks().length > 0) list.push("no_headphones");
      list.sort();
      setAlerts((prev) => (prev.join() === list.join() ? prev : list));
      const shownBehind = behind !== null && behind >= UPLOAD_BEHIND_AFTER_S ? behind : null;
      setBehindS(shownBehind);

      // Still reported after the recording stops, so the host keeps seeing the balance.
      const talk = talkFor ? { recordingId: talkFor, ms: Math.round(mic.talkMs) } : null;

      // Report on change at once, otherwise every few seconds so the host knows we're here.
      const key = list.join() + "|" + (shownBehind === null ? "" : Math.floor(shownBehind / 60)) + "|" + (talk ? `${talk.recordingId}:${Math.floor(talk.ms / 5000)}` : "");
      if (key === lastSent && now - lastSentAt < REPORT_EVERY_MS) return;
      lastSent = key;
      lastSentAt = now;
      void fetch(`/api/sessions/${encodeURIComponent(cur.ticket.sessionId)}/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cur.ticket.token}` },
        body: JSON.stringify({ alerts: list, uploadBehindS: shownBehind, talk }),
        keepalive: true,
      }).catch(() => {}); // offline: the host sees our report go stale
    };
    const evalTimer = setInterval(evaluate, 1000);
    // Going to the background is reported right away: it may be the last chance on a phone.
    document.addEventListener("visibilitychange", evaluate);
    evaluate();

    return () => {
      cancelled = true;
      clearInterval(levelTimer);
      clearInterval(diskTimer);
      clearInterval(evalTimer);
      document.removeEventListener("visibilitychange", evaluate);
      void ctx?.close().catch(() => {});
    };
  }, [q.active, q.stream, q.ticket]);

  return { alerts, uploadBehindS: behindS };
}

/** Short label for the host's list ("Upload 2 min behind"). */
export function alertLabel(a: QualityAlert, behindS: number | null): string {
  switch (a) {
    case "clipping":
      return "Mic distorting";
    case "mic_silent":
      return "Mic silent";
    case "too_quiet":
      return "Too quiet";
    case "echo":
      return "Echo";
    case "upload_behind":
      return behindS !== null && behindS >= 120 ? `Upload ${Math.floor(behindS / 60)} min behind` : "Upload behind";
    case "low_disk":
      return "Low on space";
    case "tab_hidden":
      return "Tab in background";
    case "recorder_error":
      return "Recording problem";
    case "no_headphones":
      return "No headphones";
  }
}

/** What to tell the person themselves, or null when there's nothing they can do. */
export function alertAdvice(a: QualityAlert, behindS: number | null): string | null {
  switch (a) {
    case "clipping":
      return "Your microphone is distorting. Move back a little, or turn down its input level.";
    case "mic_silent":
      return "We can't hear your microphone. Check it isn't muted on the device itself, or pick another one in your browser.";
    case "too_quiet":
      return "You're quite quiet. Move closer to the microphone, or turn up its input level.";
    case "echo":
      return "Your microphone is picking up the others from your speakers, so they're in your recording too. Put on headphones, or turn your speakers down.";
    case "upload_behind":
      return `Your upload is ${behindS !== null && behindS >= 120 ? `${Math.floor(behindS / 60)} minutes` : "a minute"} behind. The recording is safe on this computer and will catch up; keep this tab open.`;
    case "low_disk":
      return "This computer is running low on space for the recording. Free some up, or let the upload catch up before recording more.";
    default:
      return null;
  }
}

/**
 * Each person's share of the talking in a recording (0–1), from their devices' reports; null
 * until there has been TALK_SHARES_AFTER_MS of talking in all.
 */
export const TALK_SHARES_AFTER_MS = 30_000;
export function talkShares(health: SessionState["health"], recordingId: string): Map<string, number> | null {
  const talk = health.flatMap((h) => (h.talk?.recordingId === recordingId ? [[h.participantId, h.talk.ms] as const] : []));
  const total = talk.reduce((sum, [, ms]) => sum + ms, 0);
  if (total < TALK_SHARES_AFTER_MS) return null;
  return new Map(talk.map(([id, ms]) => [id, ms / total]));
}

/** The host's nudge when they're doing most of the talking, else null. */
export function talkNudge(health: SessionState["health"], recordingId: string, hostId: string): string | null {
  const talk = health.filter((h) => h.talk?.recordingId === recordingId);
  const total = talk.reduce((sum, h) => sum + h.talk!.ms, 0);
  if (talk.length < 2 || total < TALK_NUDGE_AFTER_MS) return null;
  const share = (talk.find((h) => h.participantId === hostId)?.talk?.ms ?? 0) / total;
  return share >= TALK_NUDGE_SHARE ? `You've done ${Math.round(share * 100)}% of the talking so far. Leave your guests some room.` : null;
}
