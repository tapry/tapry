// Seats: several people working in one account. An account is its owner's user row; a member
// is a user whose `account_id` points at it. Studios, recordings, the plan and storage belong
// to the account (`User.accountId`); signing in, the password and who is hosting stay personal.
import type { MembersView, acceptInviteBody } from "@tapry/shared";
import type { MemberRole } from "@tapry/shared";
import type { z } from "zod";
import type { User } from "./auth";
import type { Db, Queryable } from "./db";
import { ApiError } from "./errors";
import { hashToken, newId, newToken } from "./ids";
import { mailFailureReason, type Mailer, type MailMessage } from "./mail";
import { hashPassword } from "./passwords";

/** How long an invitation can be accepted. */
export const INVITE_DAYS = 7;
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Invitations one account may send in an hour. */
const INVITES_PER_HOUR = 20;

export interface MembersOptions {
  /** How many people the account may hold, its owner included. Null: no limit (every self-hosted server). */
  seats?: (accountId: string, db: Queryable) => Promise<number | null>;
  mail?: { mailer: Mailer; appUrl: string } | null;
  sessionTtlMs?: number;
  now?: () => number;
}

export class MembersService {
  private sent = new Map<string, number[]>();
  private now: () => number;

  constructor(
    private db: Db,
    private opts: MembersOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  private seats(accountId: string, db: Queryable = this.db) {
    return this.opts.seats ? this.opts.seats(accountId, db) : Promise.resolve(null);
  }

  /** Everyone in the signed-in person's account, and the invitations still open. */
  async view(user: User): Promise<MembersView> {
    const people = await this.db.query<{ id: string; name: string; email: string; owner: boolean; member_role: MemberRole }>(
      `SELECT id, name, email, (id = $1) AS owner, member_role FROM users WHERE id = $1 OR account_id = $1 ORDER BY (id = $1) DESC, created_at`,
      [user.accountId],
    );
    const invites = await this.db.query<{ id: string; email: string; role: MemberRole; expires_at: Date }>(
      "SELECT id, email, role, expires_at FROM account_invites WHERE account_id = $1 AND expires_at > $2 ORDER BY created_at",
      [user.accountId, new Date(this.now())],
    );
    return {
      seats: await this.seats(user.accountId),
      owner: user.accountId === user.id,
      members: people.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.owner ? "owner" : p.member_role, you: p.id === user.id })),
      // Only the owner sees who else was invited.
      invites: user.accountId === user.id ? invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expires_at.toISOString() })) : [],
    };
  }

  /**
   * Invite someone by email. Always returns the link, so it can be passed on by hand on a
   * server that sends no email; `emailed` says whether one went out too.
   */
  async invite(owner: User, email: string, linkBase: string, role: MemberRole = "member"): Promise<{ link: string; emailed: boolean }> {
    this.requireOwner(owner);
    const cutoff = this.now() - HOUR;
    const recent = (this.sent.get(owner.id) ?? []).filter((t) => t > cutoff);
    if (recent.length >= INVITES_PER_HOUR) throw new ApiError(429, "too_many_attempts", "Too many invitations. Try again in an hour.");
    this.sent.set(owner.id, [...recent, this.now()]);

    const token = newToken();
    await this.db.transaction(async (tx) => {
      // One at a time per account, so two invitations can't both take the last seat.
      await tx.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [owner.id]);
      const [existing] = await tx.query<{ id: string; account_id: string | null }>("SELECT id, account_id FROM users WHERE email = $1", [email]);
      if (existing && (existing.id === owner.id || existing.account_id === owner.id)) {
        throw new ApiError(409, "already_member", "That person is already in this account");
      }
      // A new invitation to the same address replaces the old one.
      await tx.query("DELETE FROM account_invites WHERE account_id = $1 AND (email = $2 OR expires_at <= $3)", [owner.id, email, new Date(this.now())]);
      await this.requireFreeSeat(tx, owner.id);
      await tx.query("INSERT INTO account_invites (id, token_hash, account_id, email, expires_at, role) VALUES ($1, $2, $3, $4, $5, $6)", [
        newId("inv"),
        hashToken(token),
        owner.id,
        email,
        new Date(this.now() + INVITE_DAYS * DAY),
        role,
      ]);
    });
    const link = `${(this.opts.mail?.appUrl ?? linkBase).replace(/\/$/, "")}/invite/${token}`;
    let emailed = false;
    if (this.opts.mail) {
      try {
        await this.opts.mail.mailer.send(inviteMessage(email, owner.name, link));
        emailed = true;
      } catch (err) {
        // By its code only: the message can quote the address. The owner still gets the link.
        console.error(`[members] invitation not sent: ${mailFailureReason(err)}`);
      }
    }
    return { link, emailed };
  }

  private async requireFreeSeat(tx: Queryable, accountId: string) {
    const seats = await this.seats(accountId, tx);
    if (seats === null) return;
    const [{ used }] = (await tx.query<{ used: number }>(
      `SELECT (SELECT count(*) FROM users WHERE id = $1 OR account_id = $1)::int
            + (SELECT count(*) FROM account_invites WHERE account_id = $1 AND expires_at > $2)::int AS used`,
      [accountId, new Date(this.now())],
    )) as [{ used: number }];
    if (used >= seats) {
      throw new ApiError(
        409,
        "no_free_seat",
        seats === 1 ? "Your plan is for one person. A bigger plan (Settings, Plan) has seats for more." : `All ${seats} seats of your plan are taken, counting open invitations.`,
      );
    }
  }

  async revokeInvite(owner: User, inviteId: string) {
    this.requireOwner(owner);
    await this.db.query("DELETE FROM account_invites WHERE id = $1 AND account_id = $2", [inviteId, owner.id]);
  }

  /** What the invitation page shows before anyone signs in: who invites, and which address. Null: no such invitation. */
  async invitation(token: string): Promise<{ inviter: string; email: string; hasAccount: boolean } | null> {
    const [row] = await this.db.query<{ inviter: string; email: string; has_account: boolean }>(
      `SELECT u.name AS inviter, i.email, EXISTS (SELECT 1 FROM users x WHERE x.email = i.email) AS has_account
       FROM account_invites i JOIN users u ON u.id = i.account_id WHERE i.token_hash = $1 AND i.expires_at > $2`,
      [hashToken(token), new Date(this.now())],
    );
    return row ? { inviter: row.inviter, email: row.email, hasAccount: row.has_account } : null;
  }

  /**
   * Accept an invitation. Someone new sets a name and password and gets an account for the
   * invited address (even where sign-up is closed: the owner asked for them). Someone signed
   * in with that address joins as they are, provided they have nothing of their own to leave behind.
   * Returns a login token for a new account, null when the signed-in person joined.
   */
  async accept(token: string, body: z.infer<typeof acceptInviteBody>, signedIn: User | null): Promise<{ userId: string; token: string | null }> {
    const passwordHash = signedIn ? null : body.password ? await hashPassword(body.password) : null;
    return this.db.transaction(async (tx) => {
      const [invite] = await tx.query<{ id: string; account_id: string; email: string; role: MemberRole }>(
        "SELECT id, account_id, email, role FROM account_invites WHERE token_hash = $1 AND expires_at > $2 FOR UPDATE",
        [hashToken(token), new Date(this.now())],
      );
      if (!invite) throw new ApiError(404, "invite_not_found", "This invitation has been used, withdrawn or has run out. Ask for a new one.");

      let userId: string;
      let login: string | null = null;
      if (signedIn) {
        if (signedIn.email !== invite.email) {
          throw new ApiError(403, "invite_for_someone_else", "This invitation is for another email address. Log out, then open the link again.");
        }
        const [own] = await tx.query<{ studios: number; members: number }>(
          `SELECT (SELECT count(*) FROM studios WHERE owner_id = $1 AND deleted_at IS NULL)::int AS studios,
                  (SELECT count(*) FROM users WHERE account_id = $1)::int AS members`,
          [signedIn.id],
        );
        if (signedIn.accountId !== signedIn.id) throw new ApiError(409, "already_in_account", "You are already in someone's account. Leave it first (Settings, Members).");
        if (own!.studios > 0 || own!.members > 0) {
          throw new ApiError(409, "has_own_account", "Your account has studios or members of its own, which you would lose sight of. Delete or hand them over first.");
        }
        userId = signedIn.id;
        await tx.query("UPDATE users SET account_id = $2, member_role = $4, email_verified_at = coalesce(email_verified_at, $3) WHERE id = $1", [userId, invite.account_id, new Date(this.now()), invite.role]);
      } else {
        if (!body.name || !passwordHash) throw new ApiError(400, "invalid_request", "A name and a password are needed");
        userId = newId("usr");
        // The owner vouched for this address by inviting it: nothing more to confirm.
        const [row] = await tx.query(
          `INSERT INTO users (id, email, name, password_hash, is_admin, account_id, email_verified_at, member_role) VALUES ($1, $2, $3, $4, false, $5, $6, $7)
           ON CONFLICT (email) DO NOTHING RETURNING id`,
          [userId, invite.email, body.name, passwordHash, invite.account_id, new Date(this.now()), invite.role],
        );
        if (!row) throw new ApiError(409, "email_taken", "This address already has an account. Log in with it, then open the invitation link again.");
        login = newToken();
        await tx.query("INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
          hashToken(login),
          userId,
          new Date(this.now() + (this.opts.sessionTtlMs ?? 30 * DAY)),
        ]);
      }
      await tx.query("DELETE FROM account_invites WHERE id = $1", [invite.id]);
      return { userId, token: login };
    });
  }

  /**
   * Take someone out of the account: the owner removes a member, or a member leaves. They keep
   * their login and an empty account of their own; everything they made stays with the account.
   */
  async remove(user: User, memberId: string) {
    if (memberId === user.accountId) throw new ApiError(409, "owner_stays", "The account's owner can't be removed");
    if (memberId !== user.id) this.requireOwner(user);
    const gone = await this.db.query("UPDATE users SET account_id = NULL, member_role = 'member' WHERE id = $1 AND account_id = $2 RETURNING id", [memberId, user.accountId]);
    if (gone.length === 0) throw new ApiError(404, "member_not_found", "No such member");
    // Signed out everywhere: pages they have open would otherwise still show the account.
    await this.db.query("DELETE FROM user_sessions WHERE user_id = $1", [memberId]);
  }

  /** The owner changes what a member may do. */
  async setRole(owner: User, memberId: string, role: MemberRole) {
    this.requireOwner(owner);
    const changed = await this.db.query("UPDATE users SET member_role = $3 WHERE id = $1 AND account_id = $2 RETURNING id", [memberId, owner.id, role]);
    if (changed.length === 0) throw new ApiError(404, "member_not_found", "No such member");
  }

  private requireOwner(user: User) {
    if (user.accountId !== user.id) throw new ApiError(403, "owner_only", "Only the account's owner can do this");
  }
}

/** Things only an account's owner may do: the plan, the storage, the members. */
export function requireAccountOwner(user: User) {
  if (user.accountId !== user.id) throw new ApiError(403, "owner_only", "Only the account's owner can do this");
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function inviteMessage(to: string, inviter: string, link: string): MailMessage {
  const lines = [
    `${inviter} invited you to record with them on Tapry.`,
    `Accept here: ${link}`,
    `The link works for ${INVITE_DAYS} days. You will see their studios and recordings and can host sessions. If you don't know them, ignore this email.`,
  ];
  const p = 'style="margin:0 0 16px;font:16px/1.5 system-ui,sans-serif;color:#222"';
  return {
    to,
    subject: `${inviter} invited you to Tapry`,
    text: lines.join("\n\n"),
    html: [`<p ${p}>${escapeHtml(lines[0]!)}</p>`, `<p ${p}><a href="${escapeHtml(link)}">Accept the invitation</a></p>`, `<p ${p}>${lines[2]}</p>`].join("\n"),
  };
}
