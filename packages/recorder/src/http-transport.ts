import type { ChunkTransport, CompletedTrack, StoredChunk } from "./types.js";

export interface HttpTransportOptions {
  /** API root, e.g. "https://studio.example.com/api". */
  baseUrl: string;
  /** Extra headers (auth) for API calls. Not sent to the presigned storage URL. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  fetch?: typeof fetch;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
  }
}

/**
 * Talks to the OpenTake API (see docs/decisions/0001-one-object-per-chunk.md):
 *
 *   POST {base}/sessions/:s/tracks/:t/chunks/:seq/upload-url  → { url, headers } | { committed: true }
 *   PUT  <presigned url>                                       ← chunk bytes
 *   POST {base}/sessions/:s/tracks/:t/chunks/:seq/commit      ← { bytes, startTs, endTs, sha256 }
 *   POST {base}/sessions/:s/tracks/:t/complete                ← CompletedTrack
 */
export function createHttpTransport(opts: HttpTransportOptions): ChunkTransport {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const base = opts.baseUrl.replace(/\/+$/, "");

  const api = async <T>(path: string, body: unknown): Promise<T> => {
    const url = base + path;
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await opts.headers?.()) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new HttpError(res.status, url);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };

  const trackPath = (s: string, t: string) => `/sessions/${encodeURIComponent(s)}/tracks/${encodeURIComponent(t)}`;

  return {
    async uploadChunk(chunk: StoredChunk, mimeType: string) {
      const chunkPath = `${trackPath(chunk.sessionId, chunk.trackId)}/chunks/${chunk.seq}`;
      const sha256 = await sha256Hex(chunk.data);
      const target = await api<{ url: string; headers?: Record<string, string> } | { committed: true }>(
        `${chunkPath}/upload-url`,
        { bytes: chunk.bytes, mimeType, sha256 },
      );
      // A previous attempt got through but its response was lost.
      if ("committed" in target) return;
      const put = await doFetch(target.url, {
        method: "PUT",
        headers: { "content-type": mimeType, ...target.headers },
        body: chunk.data,
      });
      if (!put.ok) throw new HttpError(put.status, redact(target.url));
      await api(`${chunkPath}/commit`, {
        bytes: chunk.bytes,
        startTs: chunk.startTs,
        endTs: chunk.endTs,
        sha256,
      });
    },

    async completeTrack(info: CompletedTrack) {
      await api(`${trackPath(info.sessionId, info.trackId)}/complete`, info);
    },
  };
}

async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Strip the signature from presigned URLs before they end up in error messages/logs. */
function redact(url: string) {
  return url.split("?")[0]!;
}
