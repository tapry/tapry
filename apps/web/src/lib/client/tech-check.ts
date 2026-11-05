// The guest tech check (/join/<code>/check): the pieces that aren't React, kept apart so they
// can be tested. Nothing here records or uploads media; the speed test sends throwaway bytes.
import { studioSettings, type StudioSettings, type TechCheckResult } from "@tapry/shared";
import { AUDIO_BITRATE, VIDEO_BITRATE } from "./recording";

/** The live call on top of the recording: a 360p camera and the voice. */
const CALL_BITS = { video: 700_000, audio: 50_000 };

/** What this studio sends while recording, in Mbit/s: the recording plus the call. */
export function neededMbps(settings: StudioSettings) {
  const bits = settings.audioOnly
    ? AUDIO_BITRATE + CALL_BITS.audio
    : VIDEO_BITRATE[settings.videoQuality] + 2 * AUDIO_BITRATE + CALL_BITS.video + CALL_BITS.audio;
  return bits / 1_000_000;
}

const mbit = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1));

/**
 * The upload-speed verdict. Slow is never a blocker: everything is kept on the guest's computer
 * and uploads as fast as it can, so a slow line only means it finishes after the session.
 */
export function uploadCheck(mbps: number | null, settings: StudioSettings): TechCheckResult {
  if (mbps === null) return { id: "upload", tone: "danger", label: "Couldn't test your upload. Check your connection and try again." };
  const needed = neededMbps(settings);
  if (mbps >= needed * 1.2) return { id: "upload", tone: "ok", label: `Upload ${mbit(mbps)} Mbit/s: keeps up with the recording` };
  if (mbps >= needed * 0.5) {
    return {
      id: "upload",
      tone: "warn",
      label: `Upload ${mbit(mbps)} Mbit/s, a bit under the ${mbit(needed)} this studio sends. The last minutes may finish uploading after the session: keep the tab open until it says so.`,
    };
  }
  return {
    id: "upload",
    tone: "warn",
    label: `Upload ${mbit(mbps)} Mbit/s, well under the ${mbit(needed)} this studio sends. Your recording is safe, but uploading may take a long while after the session. A wired connection or sitting closer to the Wi-Fi helps.`,
  };
}

/** What each kind of studio needs, for the upload-speed tool: ok when the line keeps up with it. */
export function uploadVerdicts(mbps: number) {
  const base = studioSettings.parse({});
  return [
    { kind: "Sound only", settings: { ...base, audioOnly: true } },
    { kind: "Standard video (720p)", settings: { ...base, videoQuality: "720p" as const } },
    { kind: "Full HD video (1080p)", settings: base },
  ].map(({ kind, settings }) => ({ kind, needed: neededMbps(settings), ok: mbps >= neededMbps(settings) * 1.2 }));
}

/** "Chrome on macOS", for the host's list. */
export function describeBrowser(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Another browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return os ? `${browser} on ${os}` : browser;
}

/**
 * Measure the upload to `url` (an endpoint that reads and drops POSTed bytes): pieces start at
 * 256 KB and double while each takes under 0.75 s, so a fast line isn't judged by its round
 * trips. The first piece warms the connection up and isn't counted (unless it's all there is).
 * Runs for about `forMs`, sends at most `maxBytes`. Mbit/s, or null when nothing got through.
 */
export async function measureUpload(url: string, { forMs = 5_000, maxBytes = 32 * 1024 * 1024 } = {}) {
  const MAX_PIECE = 8 * 1024 * 1024;
  const data = new Uint8Array(MAX_PIECE);
  crypto.getRandomValues(data.subarray(0, 65_536)); // not all zeros, in case anything compresses
  let size = 256 * 1024;
  let sent = 0;
  let bytes = 0;
  let seconds = 0;
  let first: { bytes: number; seconds: number } | null = null;
  const start = performance.now();
  try {
    while (sent < maxBytes && (sent === 0 || performance.now() - start < forMs)) {
      const t0 = performance.now();
      const res = await fetch(url, { method: "POST", body: data.subarray(0, size), signal: AbortSignal.timeout(30_000) });
      const dt = (performance.now() - t0) / 1000;
      if (!res.ok) break;
      sent += size;
      if (first) {
        bytes += size;
        seconds += dt;
      } else {
        first = { bytes: size, seconds: dt };
      }
      if (dt < 0.75) size = Math.min(size * 2, MAX_PIECE);
    }
  } catch {
    // Offline, limited or timed out: report what got through.
  }
  if (seconds === 0) return first ? (first.bytes * 8) / first.seconds / 1_000_000 : null;
  return (bytes * 8) / seconds / 1_000_000;
}
