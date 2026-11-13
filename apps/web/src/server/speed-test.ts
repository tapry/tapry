// Upload-speed testing: the browser sends throwaway bytes, the server reads and drops them, and
// the browser times it. Used by the guest tech check (invite code required) and by the public
// upload-speed tool (no account, so limited per address).
import { ApiError } from "./errors";

/** Read and drop a request body; 413 past `maxBytes`. Returns how many bytes arrived. */
export async function drainBody(body: ReadableStream<Uint8Array> | null, maxBytes: number) {
  let bytes = 0;
  if (!body) return bytes;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return bytes;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "too_large", "Too much test data");
    }
  }
}

/** Bytes one address may send to the public speed test per minute: a few full tests, no more. */
export const PUBLIC_SPEED_TEST_BYTES_PER_MINUTE = 64 * 1024 * 1024;

/** Per-address byte budget over a sliding minute, in memory (a restart forgets it, which is fine). */
export class SpeedTestLimiter {
  private used = new Map<string, Array<{ t: number; bytes: number }>>();

  constructor(
    private budget = PUBLIC_SPEED_TEST_BYTES_PER_MINUTE,
    private now: () => number = Date.now,
    private windowMs = 60_000,
  ) {}

  /** What this address may still send now. */
  remaining(key: string) {
    const t = this.now();
    const recent = (this.used.get(key) ?? []).filter((u) => u.t > t - this.windowMs);
    if (recent.length) this.used.set(key, recent);
    else this.used.delete(key);
    return Math.max(0, this.budget - recent.reduce((n, u) => n + u.bytes, 0));
  }

  record(key: string, bytes: number) {
    const list = this.used.get(key) ?? [];
    list.push({ t: this.now(), bytes });
    this.used.set(key, list);
  }
}

/** The visitor's address as our proxy (Caddy) reports it: the last X-Forwarded-For entry. */
export function clientAddress(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",").at(-1)?.trim() || "direct";
}

/** CORS headers for an allowed origin (the project website), or none. `credentials`: the browser may send our cookie. */
export function siteCors(req: Request, allowed: string[], opts: { methods?: string; credentials?: boolean } = {}): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !allowed.includes(origin)) return { vary: "origin" };
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": opts.methods ?? "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    ...(opts.credentials ? { "access-control-allow-credentials": "true" } : {}),
    vary: "origin",
  };
}
export const speedTestCors = (req: Request, allowed: string[]) => siteCors(req, allowed);
