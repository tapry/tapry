import type { TrackKind } from "./types.js";

// Order matters: first supported wins. WebM for Chromium/Firefox, MP4 for Safari.
const VIDEO_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/webm",
  "video/mp4",
];

const AUDIO_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/webm",
  "audio/mp4",
];

// Picture only, small and cheap to encode: VP8 first, then VP9, then MP4 for Safari.
const MASK_TYPES = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm", "video/mp4;codecs=avc1.42E01E", "video/mp4"];

export function pickMimeType(
  kind: TrackKind,
  isTypeSupported: (type: string) => boolean = (t) => MediaRecorder.isTypeSupported(t),
): string {
  const candidates = kind === "video" ? VIDEO_TYPES : kind === "mask" ? MASK_TYPES : AUDIO_TYPES;
  const found = candidates.find((t) => isTypeSupported(t));
  if (!found) throw new Error(`No supported MediaRecorder ${kind} format in this browser`);
  return found;
}

/** File extension for a recorded mime type, for naming downloads. */
export function extensionFor(mimeType: string): string {
  const base = mimeType.split(";")[0]!.trim();
  if (base.endsWith("/webm")) return "webm";
  if (base.endsWith("/mp4")) return base.startsWith("audio") ? "m4a" : "mp4";
  if (base.endsWith("/ogg")) return "ogg";
  return "bin";
}
