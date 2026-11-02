// The guest tech check (/join/<code>/check): the pieces that aren't React, kept apart so they
// can be tested. Nothing here records or uploads media; the speed test sends throwaway bytes.
import type { StudioSettings, TechCheckResult } from "@tapry/shared";
import { AUDIO_BITRATE, VIDEO_BITRATE } from "./recording";

/** The live call on top of the recording: a 360p camera and the voice. */
const CALL_BITS = { video: 700_000, audio: 50_000 };

/** What this show sends while recording, in Mbit/s: the recording plus the call. */
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
      label: `Upload ${mbit(mbps)} Mbit/s, a bit under the ${mbit(needed)} this show sends. The last minutes may finish uploading after the session: keep the tab open until it says so.`,
    };
  }
  return {
    id: "upload",
    tone: "warn",
    label: `Upload ${mbit(mbps)} Mbit/s, well under the ${mbit(needed)} this show sends. Your recording is safe, but uploading may take a long while after the session. A wired connection or sitting closer to the Wi-Fi helps.`,
  };
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
 * Measure the upload: send 1 MB pieces of throwaway data for about `forMs`, at most `maxBytes`,
 * and return Mbit/s. Null when nothing got through.
 */
export async function measureUpload(inviteCode: string, { forMs = 4_000, maxBytes = 8 * 1024 * 1024 } = {}) {
  const piece = new Uint8Array(1024 * 1024);
  crypto.getRandomValues(piece.subarray(0, 65_536)); // not all zeros, in case anything compresses
  const start = performance.now();
  let sent = 0;
  try {
    while (sent < maxBytes && (sent === 0 || performance.now() - start < forMs)) {
      const res = await fetch(`/api/check/${encodeURIComponent(inviteCode)}/upload`, {
        method: "POST",
        body: piece,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) break;
      sent += piece.byteLength;
    }
  } catch {
    // Offline or timed out: report what got through.
  }
  const seconds = (performance.now() - start) / 1000;
  return sent > 0 ? (sent * 8) / seconds / 1_000_000 : null;
}
