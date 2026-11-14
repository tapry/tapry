// Working on recordings together: comments on a recording, and the account's activity log.
import type { User } from "./auth";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { newId } from "./ids";

export const MAX_COMMENTS = 500;
/** How long activity is kept. */
export const ACTIVITY_DAYS = 365;

export interface Comment {
  id: string;
  /** Who wrote it; their name as it was then. */
  author: string;
  /** The moment of the recording it is about (ms from its start), when it has one. */
  atMs: number | null;
  body: string;
  createdAt: string;
  /** The signed-in person may delete it (their own, or they own the account). */
  mine: boolean;
}

/** Notes people of an account leave on a recording, optionally at a moment of it. */
export class CommentsService {
  constructor(private db: Db) {}

  private async owned(user: User, recordingId: string) {
    const [rec] = await this.db.query<{ comments: number }>(
      `SELECT (SELECT count(*)::int FROM comments c WHERE c.recording_id = r.id) AS comments
       FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.id = $1 AND st.owner_id = $2 AND r.deleted_at IS NULL AND st.deleted_at IS NULL`,
      [recordingId, user.accountId],
    );
    if (!rec) throw new ApiError(404, "recording_not_found", "Recording not found");
    return rec;
  }

  async list(user: User, recordingId: string): Promise<Comment[]> {
    await this.owned(user, recordingId);
    const rows = await this.db.query<{ id: string; user_id: string | null; author: string; at_ms: number | null; body: string; created_at: Date }>(
      "SELECT id, user_id, author, at_ms, body, created_at FROM comments WHERE recording_id = $1 ORDER BY created_at, id",
      [recordingId],
    );
    return rows.map((r) => ({
      id: r.id,
      author: r.author,
      atMs: r.at_ms === null ? null : Number(r.at_ms),
      body: r.body,
      createdAt: new Date(r.created_at).toISOString(),
      mine: r.user_id === user.id || user.accountId === user.id,
    }));
  }

  async add(user: User, recordingId: string, body: { body: string; atMs?: number }): Promise<void> {
    const rec = await this.owned(user, recordingId);
    if (rec.comments >= MAX_COMMENTS) throw new ApiError(429, "too_many_comments", "This recording has all the comments it can hold");
    await this.db.query("INSERT INTO comments (id, recording_id, user_id, author, at_ms, body) VALUES ($1, $2, $3, $4, $5, $6)", [
      newId("cmt"),
      recordingId,
      user.apiKey ? null : user.id, // a key isn't a user

      user.name,
      body.atMs === undefined ? null : Math.max(0, Math.round(body.atMs)),
      body.body,
    ]);
  }

  /** Their own comment, or any comment for the account's owner. */
  async remove(user: User, recordingId: string, commentId: string) {
    await this.owned(user, recordingId);
    const gone = await this.db.query("DELETE FROM comments WHERE id = $1 AND recording_id = $2 AND (user_id = $3 OR $4) RETURNING id", [commentId, recordingId, user.id, user.accountId === user.id]);
    if (gone.length === 0) throw new ApiError(404, "comment_not_found", "No such comment of yours");
  }
}

export interface Activity {
  id: string;
  who: string;
  /** What they did, in words ("Deleted a recording"). */
  action: string;
  /** What it was done to ("Interviews, Recording 3"), when that could be named. */
  target: string;
  at: string;
}

/**
 * The account's activity log: who changed or took what, and when. Written by the API after a
 * change went through; the account's owner reads it. Names of things, never their content.
 */
export class ActivityService {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  /** What a request is about, in words, looked up before it runs (afterwards it may be gone). */
  async describe(user: User, given: Record<string, string | undefined> | undefined): Promise<string> {
    // A route without parameters in its address is called with none at all.
    const params = given ?? {};
    if (params.recordingId) {
      const [r] = await this.db.query<{ studio: string; number: number | null }>(
        `SELECT st.name AS studio, r.number FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
         WHERE r.id = $1 AND st.owner_id = $2`,
        [params.recordingId, user.accountId],
      );
      if (r) return `${r.studio}, Recording ${r.number ?? "?"}`;
    }
    if (params.studioId) {
      const [s] = await this.db.query<{ name: string }>("SELECT name FROM studios WHERE id = $1 AND owner_id = $2", [params.studioId, user.accountId]);
      if (s) return s.name;
    }
    if (params.userId) {
      const [u] = await this.db.query<{ name: string }>("SELECT name FROM users WHERE id = $1 AND (id = $2 OR account_id = $2)", [params.userId, user.accountId]);
      if (u) return u.name;
    }
    return "";
  }

  /** Never fails the request it describes. */
  async record(user: User, action: string, target: string) {
    try {
      await this.db.query("INSERT INTO activity (id, account_id, user_id, who, action, target, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
        newId("act"),
        user.accountId,
        user.apiKey ? null : user.id,
        user.name,
        action,
        target.slice(0, 300),
        new Date(this.now()),
      ]);
      // Now and then, old entries go.
      if (Math.random() < 0.02) await this.db.query("DELETE FROM activity WHERE created_at < $1", [new Date(this.now() - ACTIVITY_DAYS * 86_400_000)]);
    } catch (err) {
      console.error("[activity] could not record:", err instanceof Error ? err.name : "unknown");
    }
  }

  /** The newest entries, for the account's owner. */
  /**
   * The whole log as a CSV file (time in UTC, who, what, which thing), oldest first: for an
   * organisation's own records. Cells that a spreadsheet would run as a formula are defused.
   */
  async csv(user: User): Promise<string> {
    const rows = (await this.list(user, 50_000)).reverse();
    const cell = (v: string) => {
      const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return ["Time (UTC),Who,Action,On", ...rows.map((r) => [r.at, r.who, r.action, r.target].map(cell).join(","))].join("\r\n") + "\r\n";
  }

  async list(user: User, limit = 200): Promise<Activity[]> {
    if (user.accountId !== user.id) throw new ApiError(403, "owner_only", "Only the account's owner can see the activity log");
    const rows = await this.db.query<{ id: string; who: string; action: string; target: string; created_at: Date }>(
      "SELECT id, who, action, target, created_at FROM activity WHERE account_id = $1 ORDER BY seq DESC LIMIT $2",
      [user.accountId, limit],
    );
    return rows.map((r) => ({ id: r.id, who: r.who, action: r.action, target: r.target, at: new Date(r.created_at).toISOString() }));
  }
}
