"use client";

// Technical events from this device's call, sent to the server's log: which step a call got
// to, how long the camera took to publish, a browser error's name. It exists because a phone
// that misbehaves can't be looked at from here. Events only: never media, names or text a
// person wrote. Sent in small batches, never retried, and never allowed to break anything.
import type { SessionTicket } from "@tapry/shared";

export type Note = (code: string, detail?: string) => void;

/** At most this many events from one page: a loop somewhere must not flood the server. */
const MAX_EVENTS = 200;

export function diagFor(ticket: SessionTicket): Note {
  let sent = 0;
  let waiting: Array<{ code: string; detail?: string; atMs: number }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const events = waiting.splice(0, 40);
    if (events.length === 0) return;
    void fetch(`/api/sessions/${encodeURIComponent(ticket.sessionId)}/diag`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ticket.token}` },
      body: JSON.stringify({ events }),
      keepalive: true,
    }).catch(() => {});
    if (waiting.length > 0) timer = setTimeout(flush, 1000);
  };
  return (code, detail) => {
    if (sent >= MAX_EVENTS) return;
    sent++;
    waiting.push({ code, ...(detail ? { detail: detail.slice(0, 240) } : {}), atMs: Math.max(0, Math.round(performance.now())) });
    timer ??= setTimeout(flush, 400);
  };
}

/** An error as a short line: its name and message, nothing else. */
export function errorLine(err: unknown) {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 200);
  return String(err).slice(0, 200);
}

/** "iPhone, WebKit" and the like, from the user agent: which engine and device family, no version trail. */
export function deviceLine() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "other";
  const browser = /CriOS/.test(ua) ? "Chrome (iOS)" : /FxiOS/.test(ua) ? "Firefox (iOS)" : /EdgiOS/.test(ua) ? "Edge (iOS)" : /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "other";
  const os = /OS (\d+)[_.]/.exec(ua)?.[1] ?? /Version\/(\d+)/.exec(ua)?.[1];
  return `${device}, ${browser}${os ? `, ${os}` : ""}`;
}

/**
 * Apple's WebKit: every browser on an iPhone or iPad, and Safari on a Mac. There, every copy
 * of the camera shares the one capture, so a size asked of the call's copy can be answered by
 * changing (or stalling) the camera for the recorder too.
 */
export function isAppleWebKit(ua: string, maxTouchPoints = 0) {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return true; // an iPad saying it is a Mac
  return /Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|OPR\//.test(ua);
}

type Stat = Record<string, unknown> & { type: string; kind?: string; codecId?: string; mimeType?: string };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : "?");

function readReport(report: RTCStatsReport, type: "outbound-rtp" | "inbound-rtp") {
  let rtp: Stat | undefined;
  const codecs = new Map<string, string>();
  report.forEach((v: Stat) => {
    if (v.type === type && (v.kind ?? "video") === "video") rtp = v;
    else if (v.type === "codec" && typeof v.mimeType === "string") codecs.set(String(v.id), v.mimeType.replace(/^video\//, ""));
  });
  return rtp ? { rtp, codec: (rtp.codecId && codecs.get(String(rtp.codecId))) || "?" } : null;
}

/** What this device's camera copy is sending the call, as one line: size, rate, codec, what holds it back. */
export async function sentVideoLine(sender: RTCRtpSender | undefined) {
  if (!sender) return "no sender";
  const found = readReport(await sender.getStats(), "outbound-rtp");
  if (!found) return "nothing sent yet";
  const { rtp: o, codec } = found;
  return `${num(o.frameWidth)}x${num(o.frameHeight)} at ${num(o.framesPerSecond)} fps, ${num(o.framesEncoded)} encoded, ${num(o.framesSent)} sent, ${codec}, ${String(o.encoderImplementation ?? "?")}, limited by ${String(o.qualityLimitationReason ?? "?")}, ${num(Number(o.bytesSent ?? 0) / 1024)} KB`;
}

/** What arrives of someone's picture here, as one line; `decoded` is for noticing a picture that stopped. */
export async function receivedVideoLine(receiver: RTCRtpReceiver | undefined) {
  if (!receiver) return { line: "no receiver", decoded: -1 };
  const found = readReport(await receiver.getStats(), "inbound-rtp");
  if (!found) return { line: "nothing received yet", decoded: 0 };
  const { rtp: i, codec } = found;
  const decoded = typeof i.framesDecoded === "number" ? i.framesDecoded : -1;
  return {
    decoded,
    line: `${num(i.frameWidth)}x${num(i.frameHeight)} at ${num(i.framesPerSecond)} fps, ${num(i.framesReceived)} received, ${num(i.framesDecoded)} decoded, ${num(i.framesDropped)} dropped, ${num(i.packetsLost)} lost, ${num(i.freezeCount)} freezes, ${codec}, ${String(i.decoderImplementation ?? "?")}`,
  };
}

/** Frames this device's camera copy has encoded so far; null when that can't be read. */
export async function sentFrames(sender: RTCRtpSender | undefined): Promise<number | null> {
  if (!sender) return null;
  const found = readReport(await sender.getStats(), "outbound-rtp");
  const n = found?.rtp.framesEncoded;
  return typeof n === "number" ? n : null;
}
