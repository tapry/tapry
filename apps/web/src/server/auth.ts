import type { loginBody, signupBody } from "@opentake/shared";
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
  failureWindowMs?: number;
  now?: () => number;
}

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

  /** The first account on an install becomes admin; after that, sign-up needs allowSignup. */
  async signup(body: z.infer<typeof signupBody>): Promise<{ user: User; token: string }> {
    const passwordHash = await hashPassword(body.password);
    const id = newId("usr");
    const user = await this.db.transaction(async (tx) => {
      // Serialize sign-ups so two simultaneous "first" accounts can't both become admin.
      await tx.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
      const [{ count }] = (await tx.query<{ count: number }>("SELECT count(*)::int AS count FROM users")) as [
        { count: number },
      ];
      if (count > 0 && !this.opts.allowSignup) {
        throw new ApiError(403, "signup_closed", "Sign-up is closed on this server. Ask the admin for an account.");
      }
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

  async login(body: z.infer<typeof loginBody>): Promise<{ user: User; token: string }> {
    this.checkRateLimit(body.email);
    const [row] = await this.db.query<UserRow>("SELECT * FROM users WHERE email = $1", [body.email]);
    const ok = await verifyPassword(body.password, row?.password_hash ?? (await dummyHash()));
    if (!row || !ok) {
      this.recordFailure(body.email);
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
  private checkRateLimit(email: string) {
    const window = this.opts.failureWindowMs ?? 15 * 60 * 1000;
    const recent = (this.failures.get(email) ?? []).filter((t) => t > this.now() - window);
    this.failures.set(email, recent);
    if (recent.length >= (this.opts.maxFailures ?? 10)) {
      throw new ApiError(429, "too_many_attempts", "Too many failed sign-ins. Try again in a few minutes.");
    }
  }

  private recordFailure(email: string) {
    this.failures.set(email, [...(this.failures.get(email) ?? []), this.now()]);
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
