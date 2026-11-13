// A host's own account by email: confirming the address and setting a new password.
// Both need the server to send email (SMTP_HOST); without it neither is offered.
// Confirming is required only on Tapry Cloud, where anyone can sign up.
import type { User } from "./auth";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { hashToken, newToken } from "./ids";
import { mailFailureReason, type Mailer, type MailMessage } from "./mail";
import { hashPassword } from "./passwords";

/** How long the link in a password email works. */
export const RESET_LINK_MS = 60 * 60 * 1000;
/** How long the link in a "confirm your address" email works. */
export const VERIFY_LINK_MS = 3 * 24 * 60 * 60 * 1000;

const HOUR = 60 * 60 * 1000;
/** Emails of one kind to one account in an hour. */
const PER_ACCOUNT = 3;
/** Password emails asked for from one address in an hour, whatever the accounts. */
const PER_ADDRESS = 10;
const MAX_TRACKED = 10_000;

export interface AccountOptions {
  /** Unset: the server sends no email, and none of this is offered. */
  mail?: { mailer: Mailer; appUrl: string } | null;
  /** New accounts must confirm their address before they can create or open a studio (Tapry Cloud). */
  requireVerified?: boolean;
  now?: () => number;
}

export class AccountService {
  private sent = new Map<string, number[]>();
  private now: () => number;

  constructor(
    private db: Db,
    private opts: AccountOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** Whether this server can send the emails at all. */
  get mailOn() {
    return !!this.opts.mail;
  }

  /** Whether an account must confirm its address before it can use the studio. */
  get verificationRequired() {
    return !!this.opts.requireVerified && this.mailOn;
  }

  /** Refuse an account that still has to confirm its address. */
  requireVerified(user: User) {
    if (this.verificationRequired && !user.emailVerified) {
      throw new ApiError(403, "email_unverified", "Confirm your email address first: we sent you a link. You can ask for a new one from the top of the page.");
    }
  }

  /**
   * "I forgot my password." Answers the same whether or not the address has an account, and
   * doesn't wait for the email, so neither the answer nor its timing says which addresses exist.
   */
  async requestReset(email: string, address: string) {
    const mail = this.requireMail();
    if (!this.allow(`addr:${address}`, PER_ADDRESS)) {
      throw new ApiError(429, "too_many_attempts", "Too many requests. Try again in an hour.");
    }
    const [user] = await this.db.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
    // Past the per-account limit it is dropped without saying so.
    if (!user || !this.allow(`reset:${user.id}`, PER_ACCOUNT)) return;
    const token = await this.issue(user.id, "reset", RESET_LINK_MS);
    this.send(mail.mailer, resetMessage(email, `${base(mail.appUrl)}/reset/${token}`));
  }

  /** Set a new password with the emailed link. Signs every device out, and uses the link up. */
  async reset(token: string, password: string) {
    const passwordHash = await hashPassword(password);
    await this.db.transaction(async (tx) => {
      const [row] = await tx.query<{ user_id: string }>(
        "DELETE FROM account_tokens WHERE token_hash = $1 AND kind = 'reset' AND expires_at > $2 RETURNING user_id",
        [hashToken(token), new Date(this.now())],
      );
      if (!row) throw invalidLink();
      // Reaching the mailbox proves the address too.
      await tx.query("UPDATE users SET password_hash = $2, email_verified_at = coalesce(email_verified_at, $3) WHERE id = $1", [
        row.user_id,
        passwordHash,
        new Date(this.now()),
      ]);
      await tx.query("DELETE FROM user_sessions WHERE user_id = $1", [row.user_id]);
      await tx.query("DELETE FROM account_tokens WHERE user_id = $1", [row.user_id]);
    });
  }

  /** Send the "confirm your address" email. Returns false when there was nothing to send. */
  async sendVerification(user: User): Promise<boolean> {
    if (!this.verificationRequired || user.emailVerified) return false;
    const mail = this.requireMail();
    if (!this.allow(`verify:${user.id}`, PER_ACCOUNT)) {
      throw new ApiError(429, "too_many_attempts", "We've sent a few already. Look in your inbox and spam folder, or try again in an hour.");
    }
    const token = await this.issue(user.id, "verify", VERIFY_LINK_MS);
    this.send(mail.mailer, verifyMessage(user.email, user.name, `${base(mail.appUrl)}/verify/${token}`));
    return true;
  }

  /** The emailed link was opened and confirmed. */
  async verify(token: string) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.query<{ user_id: string }>(
        "DELETE FROM account_tokens WHERE token_hash = $1 AND kind = 'verify' AND expires_at > $2 RETURNING user_id",
        [hashToken(token), new Date(this.now())],
      );
      if (!row) throw invalidLink();
      await tx.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, $2) WHERE id = $1", [row.user_id, new Date(this.now())]);
      await tx.query("DELETE FROM account_tokens WHERE user_id = $1 AND kind = 'verify'", [row.user_id]);
    });
  }

  private requireMail() {
    if (!this.opts.mail) {
      throw new ApiError(409, "email_off", "This server doesn't send email. Ask whoever runs it for help with your account.");
    }
    return this.opts.mail;
  }

  /** A new link of this kind replaces the older ones: only the latest email works. */
  private async issue(userId: string, kind: "reset" | "verify", ttlMs: number) {
    const token = newToken();
    await this.db.transaction(async (tx) => {
      await tx.query("DELETE FROM account_tokens WHERE (user_id = $1 AND kind = $2) OR expires_at <= $3", [userId, kind, new Date(this.now())]);
      await tx.query("INSERT INTO account_tokens (token_hash, user_id, kind, expires_at) VALUES ($1, $2, $3, $4)", [
        hashToken(token),
        userId,
        kind,
        new Date(this.now() + ttlMs),
      ]);
    });
    return token;
  }

  /** Not awaited by callers. A failure is logged by its code only: the message can quote the address. */
  private send(mailer: Mailer, message: MailMessage) {
    void mailer.send(message).catch((err) => console.error(`[account] email not sent: ${mailFailureReason(err)}`));
  }

  // In memory, per process, like the login limits.
  private allow(key: string, max: number) {
    const cutoff = this.now() - HOUR;
    const recent = (this.sent.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= max) return false;
    this.sent.set(key, [...recent, this.now()]);
    if (this.sent.size > MAX_TRACKED) {
      for (const [k, times] of this.sent) if (!times.some((t) => t > cutoff)) this.sent.delete(k);
    }
    return true;
  }
}

const base = (appUrl: string) => appUrl.replace(/\/$/, "");
const invalidLink = () => new ApiError(400, "link_invalid", "This link has been used or has run out.");

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const P = 'style="margin:0 0 16px;font:16px/1.5 system-ui,sans-serif;color:#222"';

export function resetMessage(to: string, link: string): MailMessage {
  const lines = [
    "Someone asked to set a new password for your Tapry account.",
    `Set it here: ${link}`,
    "The link works for one hour, once. If this wasn't you, ignore this email: your password stays as it is.",
  ];
  return {
    to,
    subject: "Set a new Tapry password",
    text: lines.join("\n\n"),
    html: [`<p ${P}>${lines[0]}</p>`, `<p ${P}><a href="${escapeHtml(link)}">Set a new password</a></p>`, `<p ${P}>${lines[2]}</p>`].join("\n"),
  };
}

export function verifyMessage(to: string, name: string, link: string): MailMessage {
  const lines = [
    `Hello ${name},`,
    `Confirm this address for your Tapry account: ${link}`,
    "The link works for three days. If you didn't create an account, ignore this email.",
  ];
  return {
    to,
    subject: "Confirm your email for Tapry",
    text: lines.join("\n\n"),
    html: [`<p ${P}>Hello ${escapeHtml(name)},</p>`, `<p ${P}><a href="${escapeHtml(link)}">Confirm this address</a> for your Tapry account.</p>`, `<p ${P}>${lines[2]}</p>`].join("\n"),
  };
}
