import type { SessionState } from "@tapry/shared";

export interface SseMessage {
  event: string;
  data: string;
}

/** Split a buffer of SSE text into complete messages plus the unfinished remainder. */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
  const messages: SseMessage[] = [];
  const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue; // comment / keep-alive ping
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) messages.push({ event, data: data.join("\n") });
  }
  return { messages, rest };
}

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "unauthorized";

/**
 * Follows a session's state over SSE. Uses fetch rather than EventSource so the
 * bearer token goes in a header, not the URL. Reconnects with backoff; every
 * (re)connect starts with a full snapshot, so nothing is lost while offline.
 * Returns a function that stops it.
 */
export function followSession(
  sessionId: string,
  token: string,
  onState: (state: SessionState) => void,
  onStatus: (status: ConnectionStatus) => void = () => {},
): () => void {
  const abort = new AbortController();
  let attempt = 0;

  const run = async () => {
    while (!abort.signal.aborted) {
      onStatus(attempt === 0 ? "connecting" : "reconnecting");
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/events`, {
          headers: { authorization: `Bearer ${token}` },
          signal: abort.signal,
        });
        if (res.status === 401 || res.status === 403) {
          onStatus("unauthorized");
          return;
        }
        if (!res.ok || !res.body) throw new Error(`events → ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSse(buffer);
          buffer = parsed.rest;
          for (const m of parsed.messages) {
            if (m.event !== "state") continue;
            attempt = 0;
            onStatus("live");
            onState(JSON.parse(m.data) as SessionState);
          }
        }
      } catch {
        if (abort.signal.aborted) return;
      }
      attempt++;
      await new Promise((r) => setTimeout(r, Math.min(10_000, 500 * 2 ** Math.min(attempt, 5))));
    }
  };
  void run();
  return () => abort.abort();
}
