// Pure green-room logic: no React, no live devices. Unit-tested in test/media.test.ts.
import { pickMimeType } from "@tapry/recorder";
import type { StudioSettings } from "@tapry/shared";

// ── Capture constraints ──────────────────────────────────────────────────────

export interface DeviceChoice {
  audioDeviceId?: string;
  videoDeviceId?: string;
  cameraOff?: boolean;
  /** Guest says they're on headphones: no echo to cancel, so skip processing for cleaner audio. */
  headphones: boolean;
}

export function buildConstraints(settings: StudioSettings, choice: DeviceChoice): MediaStreamConstraints {
  const [width, height] = settings.videoQuality === "1080p" ? [1920, 1080] : [1280, 720];
  // Browser voice processing helps on speakers but colors the sound; podcasters fix the rest in post.
  const processing = settings.echoCancellation && !choice.headphones;
  return {
    audio: {
      ...(choice.audioDeviceId ? { deviceId: { exact: choice.audioDeviceId } } : {}),
      sampleRate: { ideal: 48_000 },
      channelCount: { ideal: 1 },
      echoCancellation: processing,
      noiseSuppression: processing,
      autoGainControl: false, // AGC pumps levels up and down mid-sentence
    },
    video: choice.cameraOff || settings.audioOnly
      ? false
      : {
          ...(choice.videoDeviceId ? { deviceId: { exact: choice.videoDeviceId } } : {}),
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: 30, max: 30 },
        },
  };
}

/** Same constraints without pinned device ids: the fallback when a saved device has gone away. */
export function withoutDeviceIds(c: MediaStreamConstraints): MediaStreamConstraints {
  const strip = (t: boolean | MediaTrackConstraints | undefined) => {
    if (typeof t !== "object") return t;
    const { deviceId: _ignored, ...rest } = t;
    return rest;
  };
  return { audio: strip(c.audio), video: strip(c.video) };
}

// ── Errors ───────────────────────────────────────────────────────────────────

export interface MediaProblem {
  title: string;
  help: string;
  /** A pinned device id no longer matches anything: retry with defaults. */
  retryWithDefaults?: boolean;
}

export function describeMediaError(err: unknown): MediaProblem {
  const name = (err as { name?: string })?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        title: "Camera and microphone are blocked",
        help: "Click the camera icon in the address bar, allow access for this site, then press Try again.",
      };
    case "NotFoundError":
      return {
        title: "No microphone found",
        help: "Plug in a microphone or headset, then press Try again.",
      };
    case "OverconstrainedError":
      return {
        title: "That device isn't available anymore",
        help: "Switching back to your default camera and microphone.",
        retryWithDefaults: true,
      };
    case "NotReadableError":
    case "AbortError":
      return {
        title: "Your camera or microphone is busy",
        help: "Another app (Zoom, Teams, FaceTime…) may be using it. Close that app, then press Try again.",
      };
    default:
      if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia) {
        return {
          title: "This browser can't record",
          help: "Open this link in a current version of Chrome, Edge, Firefox or Safari, over https.",
        };
      }
      return { title: "Couldn't start your camera or microphone", help: "Press Try again, or reload the page." };
  }
}

// ── Mic level ────────────────────────────────────────────────────────────────

const FLOOR_DB = -100;

const toDb = (x: number) => Math.max(FLOOR_DB, 20 * Math.log10(Math.max(x, 1e-10)));

/** RMS and peak level of a block of samples (-1..1), in dBFS. */
export function measureLevel(samples: Float32Array): { rmsDb: number; peakDb: number } {
  let sum = 0;
  let peak = 0;
  for (const s of samples) {
    sum += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  return { rmsDb: toDb(Math.sqrt(sum / (samples.length || 1))), peakDb: toDb(peak) };
}

export type LevelState = "silent" | "quiet" | "good" | "clipping";

/**
 * Judge the mic from recent history, not one block: people pause between words.
 * `loudestRmsDb` is the highest RMS over the last few seconds; `peakDb` the highest peak.
 */
export function classifyLevel(loudestRmsDb: number, peakDb: number): LevelState {
  if (peakDb > -1) return "clipping";
  if (loudestRmsDb < -60) return "silent";
  if (loudestRmsDb < -38) return "quiet";
  return "good";
}

export const LEVEL_ADVICE: Record<LevelState, string> = {
  silent: "We can't hear you. Say something, or pick another microphone.",
  quiet: "You're a bit quiet. Move closer to the mic or turn up its input level.",
  good: "Sounds good.",
  clipping: "Too loud, the sound is distorting. Move back a little or lower the input level.",
};

export const METER_RELEASE_DB_PER_S = 24;

/** Next meter reading: jumps up to a louder level at once, falls at most METER_RELEASE_DB_PER_S. */
export function meterRelease(previousDb: number, currentDb: number, elapsedMs: number) {
  return Math.max(currentDb, previousDb - (METER_RELEASE_DB_PER_S * elapsedMs) / 1000);
}

/** Map dBFS to 0..1 for a meter bar (-60 dB = empty). */
export function meterFraction(db: number) {
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

// ── Headphones ───────────────────────────────────────────────────────────────

const HEADPHONE_WORDS = /head(phone|set)|earphone|earbud|\bbuds\b|airpods|earpods|beats|bose|jabra|wh-1000|wf-1000|shokz/i;

/** Best-effort guess from an audio output label. Browsers can't tell for sure; guests confirm. */
export function looksLikeHeadphones(label: string | undefined) {
  return !!label && HEADPHONE_WORDS.test(label) && !/speaker/i.test(label);
}

// ── Browser checks ───────────────────────────────────────────────────────────

export interface Check {
  id: string;
  tone: "ok" | "warn" | "danger";
  label: string;
}

export interface BrowserEnv {
  isSecureContext: boolean;
  hasMediaRecorder: boolean;
  isTypeSupported: (type: string) => boolean;
  hasIndexedDB: boolean;
  userAgent: string;
}

export function currentBrowserEnv(): BrowserEnv {
  const MR = typeof MediaRecorder === "undefined" ? undefined : MediaRecorder;
  return {
    isSecureContext: window.isSecureContext,
    hasMediaRecorder: !!MR,
    isTypeSupported: (t) => !!MR?.isTypeSupported(t),
    hasIndexedDB: typeof indexedDB !== "undefined",
    userAgent: navigator.userAgent,
  };
}

export function browserChecks(env: BrowserEnv): Check[] {
  const checks: Check[] = [];
  if (!env.isSecureContext) {
    checks.push({ id: "https", tone: "danger", label: "This page must be opened over https to use your camera." });
  }
  if (!env.hasMediaRecorder) {
    checks.push({ id: "recorder", tone: "danger", label: "This browser can't record. Use Chrome, Edge, Firefox or Safari." });
  } else {
    try {
      const format = pickMimeType("video", env.isTypeSupported).split(";")[0];
      checks.push({ id: "recorder", tone: "ok", label: `Recording supported (${format})` });
    } catch {
      checks.push({ id: "recorder", tone: "danger", label: "This browser can't record video. Try Chrome or Edge." });
    }
  }
  checks.push(
    env.hasIndexedDB
      ? { id: "storage-api", tone: "ok", label: "Local backup storage available" }
      : {
          id: "storage-api",
          tone: "danger",
          label: "Browser storage is blocked (private window?). Your recording can't be protected against crashes.",
        },
  );
  if (/Android|iPhone|iPad|Mobile/i.test(env.userAgent)) {
    checks.push({
      id: "mobile",
      tone: "warn",
      label: "On a phone, keep this tab open and the screen on: recording stops in the background. A computer is more reliable.",
    });
  }
  return checks;
}

export function storageCheck(freeBytes: number | null, ok: boolean): Check {
  if (freeBytes === null) return { id: "disk", tone: "ok", label: "Disk space: couldn't check" };
  const gb = (freeBytes / 1024 ** 3).toFixed(1);
  return ok
    ? { id: "disk", tone: "ok", label: `${gb} GB free for the local backup` }
    : {
        id: "disk",
        tone: "warn",
        label: `Only ${gb} GB free. Long recordings may not fit if your upload is slow. Free up some space.`,
      };
}

export function networkCheck(rttMs: number | null): Check {
  if (rttMs === null) return { id: "network", tone: "danger", label: "Can't reach the server. Check your connection." };
  if (rttMs > 400) {
    return {
      id: "network",
      tone: "warn",
      label: `Slow connection (${rttMs} ms). The call may lag; your recording is still saved at full quality.`,
    };
  }
  return { id: "network", tone: "ok", label: `Connection OK (${rttMs} ms)` };
}
