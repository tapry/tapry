import type { loginBody, signupBody } from "@tapry/shared";
import { createHash, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { hashToken, newId, newToken } from "./ids";
import { dummyHash, hashPassword, verifyPassword } from "./passwords";

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export interface AuthOptions {
  /** Let anyone create an account after the first (admin) one. Default false. */
  allowSignup: boolean;
  sessionTtlMs?: number;
  /** Failed logins per email before a cooldown. */
  maxFailures?: number;
  /** Failed logins from one address (any emails) before a cooldown. */
  maxFailuresPerAddress?: number;
  failureWindowMs?: number;
  /** The first account must present this, so a stranger can't take over a new install. Unset: no code. */
  setupToken?: string | null;
  now?: () => number;
}

/** Failure records kept before idle addresses and emails are dropped. */
const MAX_TRACKED = 10_000;

const DAY = 24 * 60 * 60 * 1000;

/** Host accounts: email + password, cookie sessions. Guests never have accounts. */
export class AuthService {
  private failures = new Map<string, number[]>();
  private now: () => number;

  constructor(
    private db: Db,
    private opts: AuthOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** Whether the first account needs the install's setup code. */
  get setupRequired() {
    return !!this.opts.setupToken;
  }

  /** The first account on an install becomes admin; after that, sign-up needs allowSignup. */
  async signup(body: z.infer<typeof signupBody>): Promise<{ user: User; token: string }> {
    // Refuse before the (deliberately slow) password hash, so a closed server can't be made to
    // hash for anyone; the transaction checks again under the lock.
    const [{ count: before }] = (await this.db.query<{ count: number }>("SELECT count(*)::int AS count FROM users")) as [{ count: number }];
    this.checkSignup(before, body.setupToken);
    const passwordHash = await hashPassword(body.password);
    const id = newId("usr");
    const user = await this.db.transaction(async (tx) => {
      // Serialize sign-ups so two simultaneous "first" accounts can't both become admin.
      await tx.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
      const [{ count }] = (await tx.query<{ count: number }>("SELECT count(*)::int AS count FROM users")) as [
        { count: number },
      ];
      this.checkSignup(count, body.setupToken);
      const [row] = await tx.query<UserRow>(
        `INSERT INTO users (id, email, name, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING RETURNING *`,
        [id, body.email, body.name, passwordHash, count === 0],
      );
      if (!row) throw new ApiError(409, "email_taken", "An account with this email already exists");
      return toUser(row);
    });
    return { user, token: await this.createSession(user.id) };
  }

  private checkSignup(existing: number, setupToken: string | undefined) {
    if (existing > 0) {
      if (!this.opts.allowSignup) throw new ApiError(403, "signup_closed", "Sign-up is closed on this server. Ask the admin for an account.");
      return;
    }
    const expected = this.opts.setupToken;
    if (!expected) return;
    const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
    if (!setupToken || !timingSafeEqual(digest(setupToken), digest(expected))) {
      throw new ApiError(403, "setup_token_required", "The first account needs this server's setup code (SETUP_TOKEN in its .env file)");
    }
  }

  /** `address`: the client's, for a limit across emails (an attacker trying many accounts). */
  async login(body: z.infer<typeof loginBody>, address = "unknown"): Promise<{ user: User; token: string }> {
    const addressKey = `addr:${address}`;
    this.checkRateLimit(body.email, this.opts.maxFailures ?? 10);
    this.checkRateLimit(addressKey, this.opts.maxFailuresPerAddress ?? 50);
    const [row] = await this.db.query<UserRow>("SELECT * FROM users WHERE email = $1", [body.email]);
    const ok = await verifyPassword(body.password, row?.password_hash ?? (await dummyHash()));
    if (!row || !ok) {
      this.recordFailure(body.email);
      this.recordFailure(addressKey);
      throw new ApiError(401, "invalid_credentials", "Wrong email or password");
    }
    this.failures.delete(body.email);
    return { user: toUser(row), token: await this.createSession(row.id) };
  }

  async logout(token: string | undefined) {
    if (token) await this.db.query("DELETE FROM user_sessions WHERE token_hash = $1", [hashToken(token)]);
  }

  /** The signed-in user for a session cookie, or null. */
  async userForToken(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const [row] = await this.db.query<UserRow>(
      `SELECT u.* FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > $2`,
      [hashToken(token), new Date(this.now())],
    );
    return row ? toUser(row) : null;
  }

  async requireUser(token: string | undefined): Promise<User> {
    const user = await this.userForToken(token);
    if (!user) throw new ApiError(401, "unauthorized", "Sign in first");
    return user;
  }

  private async createSession(userId: string) {
    const token = newToken();
    const expires = new Date(this.now() + (this.opts.sessionTtlMs ?? 30 * DAY));
    await this.db.query("INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
      hashToken(token),
      userId,
      expires,
    ]);
    await this.db.query("DELETE FROM user_sessions WHERE user_id = $1 AND expires_at <= $2", [userId, new Date(this.now())]);
    return token;
  }

  // In-memory, per process: enough to stop password guessing on a single-node self-host.
  // Move to Redis/Postgres when the cloud runs several web instances.
  private checkRateLimit(key: string, max: number) {
    const recent = (this.failures.get(key) ?? []).filter((t) => t > this.now() - this.window());
    if (recent.length) this.failures.set(key, recent);
    else this.failures.delete(key);
    if (recent.length >= max) {
      throw new ApiError(429, "too_many_attempts", "Too many failed sign-ins. Try again in a few minutes.");
    }
  }

  private recordFailure(key: string) {
    this.failures.set(key, [...(this.failures.get(key) ?? []), this.now()]);
    // Every new email or address adds an entry: drop the idle ones so memory can't grow without end.
    if (this.failures.size > MAX_TRACKED) {
      const cutoff = this.now() - this.window();
      for (const [k, times] of this.failures) if (!times.some((t) => t > cutoff)) this.failures.delete(k);
    }
  }

  private window() {
    return this.opts.failureWindowMs ?? 15 * 60 * 1000;
  }
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_admin: boolean;
}

const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, isAdmin: r.is_admin });
