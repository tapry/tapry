import type { SessionTicket } from "@tapry/shared";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: Array<{ path: Array<string | number>; message: string }>,
  ) {
    super(message);
  }
}

/** JSON fetch against our API. Throws ApiRequestError with the server's error code and message. */
export async function apiFetch<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
      credentials: "same-origin",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiRequestError(0, "network", "Can't reach the server. Check your connection.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.issues?.[0]?.message ?? data?.message ?? `Request failed (${res.status})`;
    throw new ApiRequestError(res.status, data?.error ?? "unknown", message, data?.issues);
  }
  return data as T;
}

// ── Session tickets ──────────────────────────────────────────────────────────
// Kept in localStorage so a guest who reloads or reopens the tab gets back in with
// the same participant (and doesn't use up another seat). Storage can be missing or
// throw (private mode, blocked site data), so every access is guarded.

// Named before the rename to Tapry; kept so data saved by older versions is still found.
const ticketKey = (sessionId: string) => `opentake:ticket:${sessionId}`;
const inviteKey = (inviteCode: string) => `opentake:invite:${inviteCode}`;

export function saveTicket(ticket: SessionTicket, inviteCode?: string) {
  try {
    localStorage.setItem(ticketKey(ticket.sessionId), JSON.stringify(ticket));
    if (inviteCode) localStorage.setItem(inviteKey(inviteCode), ticket.sessionId);
  } catch {
    // Without storage the guest simply joins again after a reload.
  }
}

export function loadTicket(sessionId: string): SessionTicket | null {
  try {
    const raw = localStorage.getItem(ticketKey(sessionId));
    return raw ? (JSON.parse(raw) as SessionTicket) : null;
  } catch {
    return null;
  }
}

/** The ticket from an earlier join through this invite link, if any. */
export function loadTicketForInvite(inviteCode: string): SessionTicket | null {
  try {
    const sessionId = localStorage.getItem(inviteKey(inviteCode));
    return sessionId ? loadTicket(sessionId) : null;
  } catch {
    return null;
  }
}

export function forgetTicket(sessionId: string) {
  try {
    localStorage.removeItem(ticketKey(sessionId));
  } catch {}
}
