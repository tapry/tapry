// For other software: API keys (the same API the app uses, with a key instead of a log-in) and
// webhooks (a signed POST to your server when a recording's files or transcript are ready).
//
// A key belongs to an account and acts as a member of it, never as its owner: it can't touch
// the plan, the members, the storage or other keys, and it can't host a session. Only its
// hash is stored. Webhook payloads carry names, ids, times and file sizes, never media or
// what was said; the receiver fetches files through the API with a key.
import { createHmac } from "node:crypto";
import type { User } from "./auth";
import type { Db, Queryable } from "./db";
import { ApiError } from "./errors";
import { hashToken, newId, newToken } from "./ids";
import { assertPublicEndpoint } from "./own-storage";

export const KEY_PREFIX = "tpk_";
export const MAX_KEYS = 20;
export const MAX_WEBHOOKS = 10;
/** Requests one key may make per minute. */
export const KEY_REQUESTS_PER_MINUTE = 300;
export const WEBHOOK_EVENTS = ["recording.ready", "recording.transcribed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
/** A delivery is tried this many times, further apart each time (about a day in all), then given up. */
export const WEBHOOK_ATTEMPTS = 8;

export interface ApiKeyView {
  id: string;
  name: string;
  /** The key's first characters, to tell keys apart. The key itself is shown once, when made. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const ownerOnly = (user: User) => {
  if (user.accountId !== user.id) throw new ApiError(403, "owner_only", "Only the account's owner can do this");
};

export class ApiKeysService {
  private used = new Map<string, number[]>();

  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  async list(owner: User): Promise<ApiKeyView[]> {
    ownerOnly(owner);
    const rows = await this.db.query<{ id: string; name: string; prefix: string; created_at: Date; last_used_at: Date | null }>(
      "SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE account_id = $1 AND revoked_at IS NULL ORDER BY created_at",
      [owner.id],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: new Date(r.created_at).toISOString(), lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null }));
  }

  /** Makes a key. The returned `key` is the only time it is ever shown. */
  async create(owner: User, name: string): Promise<ApiKeyView & { key: string }> {
    ownerOnly(owner);
    if ((await this.list(owner)).length >= MAX_KEYS) throw new ApiError(409, "too_many_keys", "This account has all the keys it can hold. Revoke one first.");
    const key = `${KEY_PREFIX}${newToken()}`;
    const id = newId("key");
    const prefix = `${key.slice(0, 10)}…`;
    await this.db.query("INSERT INTO api_keys (id, account_id, name, token_hash, prefix, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [id, owner.id, name, hashToken(key), prefix, new Date(this.now())]);
    return { id, name, prefix, createdAt: new Date(this.now()).toISOString(), lastUsedAt: null, key };
  }

  async revoke(owner: User, id: string) {
    ownerOnly(owner);
    await this.db.query("UPDATE api_keys SET revoked_at = $3 WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL", [id, owner.id, new Date(this.now())]);
  }

  /** Who a key acts as: a member of its account (never the owner), named after the key. */
  async userFor(key: string): Promise<User> {
    const [row] = await this.db.query<{ id: string; name: string; account_id: string; email: string }>(
      `SELECT k.id, k.name, k.account_id, u.email FROM api_keys k JOIN users u ON u.id = k.account_id
       WHERE k.token_hash = $1 AND k.revoked_at IS NULL`,
      [hashToken(key)],
    );
    if (!row) throw new ApiError(401, "unauthorized", "Unknown or revoked API key");
    const since = this.now() - 60_000;
    const recent = (this.used.get(row.id) ?? []).filter((t) => t > since);
    if (recent.length >= KEY_REQUESTS_PER_MINUTE) throw new ApiError(429, "slow_down", "Too many requests with this key. Try again in a minute.");
    this.used.set(row.id, [...recent, this.now()]);
    // Not on every request: once a minute is enough to tell a key that is in use from a forgotten one.
    if (recent.length === 0) await this.db.query("UPDATE api_keys SET last_used_at = $2 WHERE id = $1", [row.id, new Date(this.now())]).catch(() => {});
    return { id: row.id, email: row.email, name: `API key "${row.name}"`, isAdmin: false, emailVerified: true, accountId: row.account_id, viewer: false, apiKey: true };
  }
}

export interface WebhookView {
  id: string;
  url: string;
  createdAt: string;
  /** The last delivery that failed for good, if the newest ones did: so a dead address is noticed. */
  failing: boolean;
}

export class WebhooksService {
  constructor(
    private db: Db,
    private opts: { allowPrivate?: boolean; resolve?: (host: string) => Promise<string[]>; now?: () => number } = {},
  ) {}

  async list(owner: User): Promise<WebhookView[]> {
    ownerOnly(owner);
    const rows = await this.db.query<{ id: string; url: string; created_at: Date; failing: boolean }>(
      `SELECT w.id, w.url, w.created_at,
              coalesce((SELECT d.status = 'failed' FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.status <> 'pending' ORDER BY d.seq DESC LIMIT 1), false) AS failing
       FROM webhooks w WHERE w.account_id = $1 ORDER BY w.created_at`,
      [owner.id],
    );
    return rows.map((r) => ({ id: r.id, url: r.url, createdAt: new Date(r.created_at).toISOString(), failing: r.failing }));
  }

  /** Adds an address. The returned `secret` signs every delivery and is shown this once. */
  async create(owner: User, url: string): Promise<WebhookView & { secret: string }> {
    ownerOnly(owner);
    if (!/^https:\/\//i.test(url) && !this.opts.allowPrivate) throw new ApiError(400, "bad_endpoint", "A webhook address starts with https://");
    // No calling into private networks from this server.
    if (!this.opts.allowPrivate) await assertPublicEndpoint(url, this.opts.resolve);
    if ((await this.list(owner)).length >= MAX_WEBHOOKS) throw new ApiError(409, "too_many_webhooks", "This account has all the webhooks it can hold. Remove one first.");
    const id = newId("whk");
    const secret = `whsec_${newToken()}`;
    const at = new Date((this.opts.now ?? Date.now)());
    await this.db.query("INSERT INTO webhooks (id, account_id, url, secret, created_at) VALUES ($1, $2, $3, $4, $5)", [id, owner.id, url, secret, at]);
    return { id, url, createdAt: at.toISOString(), failing: false, secret };
  }

  async remove(owner: User, id: string) {
    ownerOnly(owner);
    await this.db.query("DELETE FROM webhooks WHERE id = $1 AND account_id = $2", [id, owner.id]);
  }
}

/**
 * Something happened to a recording: queue a delivery for each webhook of its account.
 * The payload is put together now (names, times, file names and sizes), so it says what was
 * true at that moment even if the recording changes before it is sent.
 */
export async function emitWebhook(db: Queryable, recordingId: string, event: WebhookEvent, now: number = Date.now()) {
  const [rec] = await db.query<{ id: string; number: number | null; started_at: number; stopped_at: number | null; studio_id: string; studio: string; account: string }>(
    `SELECT r.id, r.number, r.started_at, r.stopped_at, st.id AS studio_id, st.name AS studio, st.owner_id AS account
     FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id WHERE r.id = $1 AND r.deleted_at IS NULL`,
    [recordingId],
  );
  if (!rec) return;
  const hooks = await db.query<{ id: string }>("SELECT id FROM webhooks WHERE account_id = $1", [rec.account]);
  if (hooks.length === 0) return;
  const files = await db.query<{ id: string; kind: string; file_name: string; bytes: string }>("SELECT id, kind, file_name, bytes FROM outputs WHERE recording_id = $1 ORDER BY kind, file_name", [recordingId]);
  const data = {
    recording: {
      id: rec.id,
      number: rec.number,
      studio: { id: rec.studio_id, name: rec.studio },
      startedAt: new Date(Number(rec.started_at)).toISOString(),
      stoppedAt: rec.stopped_at === null ? null : new Date(Number(rec.stopped_at)).toISOString(),
      files: files.map((f) => ({ id: f.id, kind: f.kind, fileName: f.file_name, bytes: Number(f.bytes) })),
    },
  };
  for (const h of hooks) {
    await db.query("INSERT INTO webhook_deliveries (id, webhook_id, event, payload, next_at, created_at) VALUES ($1, $2, $3, $4, $5, $5)", [newId("whd"), h.id, event, JSON.stringify(data), new Date(now)]);
  }
}

/** The signature header's value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the webhook's secret>`. */
export function signWebhook(secret: string, body: string, atSeconds: number) {
  return `t=${atSeconds},v1=${createHmac("sha256", secret).update(`${atSeconds}.${body}`).digest("hex")}`;
}

/** Send what is due. A receiver that is down gets it again later; nothing here can fail a job. */
export async function deliverWebhooks(db: Db, fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  const due = await db.query<{ id: string; event: string; payload: unknown; attempts: number; created_at: Date; url: string; secret: string }>(
    `SELECT d.id, d.event, d.payload, d.attempts, d.created_at, w.url, w.secret FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
     WHERE d.status = 'pending' AND d.next_at <= $1 ORDER BY d.seq LIMIT 20`,
    [new Date(now())],
  );
  for (const d of due) {
    const body = JSON.stringify({ id: d.id, event: d.event, createdAt: new Date(d.created_at).toISOString(), ...(typeof d.payload === "string" ? JSON.parse(d.payload) : (d.payload as object)) });
    let problem: string | null = null;
    try {
      const res = await fetcher(d.url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Tapry-Webhooks", "tapry-event": d.event, "tapry-signature": signWebhook(d.secret, body, Math.floor(now() / 1000)) },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) problem = `status ${res.status}`;
    } catch (err) {
      problem = err instanceof Error ? err.name : "failed";
    }
    const attempts = d.attempts + 1;
    if (!problem) await db.query("UPDATE webhook_deliveries SET status = 'sent', attempts = $2, last_error = NULL WHERE id = $1", [d.id, attempts]);
    else if (attempts >= WEBHOOK_ATTEMPTS) await db.query("UPDATE webhook_deliveries SET status = 'failed', attempts = $2, last_error = $3 WHERE id = $1", [d.id, attempts, problem]);
    // 1, 2, 4… minutes, at most 6 hours apart.
    else await db.query("UPDATE webhook_deliveries SET attempts = $2, last_error = $3, next_at = $4 WHERE id = $1", [d.id, attempts, problem, new Date(now() + Math.min(6 * 3_600_000, 60_000 * 2 ** (attempts - 1)))]);
  }
  // Sent and given-up deliveries are kept a month, for looking into a problem.
  if (due.length > 0) await db.query("DELETE FROM webhook_deliveries WHERE status <> 'pending' AND created_at < $1", [new Date(now() - 30 * 86_400_000)]);
}
