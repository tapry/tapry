// The guest's recap email: a link to their own files, sent once they're processed. Asked for on
// the end screen, so nobody gets one unasked. The address is kept only until the mail has gone.
import { studioSettings, type RecapStatus } from "@tapry/shared";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { hashToken, newToken } from "./ids";
import type { Participant } from "./live";
import { mailFailureReason, type Mailer } from "./mail";

/** How long the emailed link works, and how long an unsent request waits for its files. */
export const RECAP_LINK_DAYS = 30;
/** One guest, one session: guards against using the server to mail strangers. */
export const MAX_RECAP_SENDS = 3;
const MAX_ATTEMPTS = 5;
/** Longer than a send can take (SMTP timeouts add up to under a minute). */
const LOCK_SECONDS = 120;

export interface RecapMail {
  mailer: Mailer;
  /** This server's public address, for the link. */
  appUrl: string;
  promoUrl: string | null;
}

export class RecapService {
  constructor(
    private db: Db,
    private enabled: boolean,
    private onQueued: () => void = () => {},
  ) {}

  async status(p: Participant): Promise<RecapStatus> {
    const [row] = await this.db.query<{ status: RecapStatus["status"]; email: string | null; sends: number }>(
      "SELECT status, email, sends FROM recap_requests WHERE participant_id = $1",
      [p.id],
    );
    return {
      enabled: this.enabled && (await this.allowed(p)),
      status: row?.status ?? "none",
      email: row?.email ?? null,
      // A pending request can always change its address: that doesn't send anything extra.
      canSend: !row || row.status === "pending" || row.sends < MAX_RECAP_SENDS,
    };
  }

  /** Send the recap to this address, replacing any earlier one. An earlier link stops working. */
  async request(p: Participant, email: string): Promise<RecapStatus> {
    if (!this.enabled) throw new ApiError(409, "email_off", "This server doesn't send email");
    if (!(await this.allowed(p))) throw new ApiError(409, "nothing_to_send", "There's no recording to send");
    await this.db.transaction(async (tx) => {
      const [row] = await tx.query<{ status: string; sends: number }>(
        "SELECT status, sends FROM recap_requests WHERE participant_id = $1 FOR UPDATE",
        [p.id],
      );
      if (row && row.status !== "pending" && row.sends >= MAX_RECAP_SENDS) {
        throw new ApiError(429, "too_many_recaps", "This recording has been emailed too many times");
      }
      await tx.query(
        `INSERT INTO recap_requests (participant_id, session_id, email) VALUES ($1, $2, $3)
         ON CONFLICT (participant_id) DO UPDATE SET
           email = EXCLUDED.email, status = 'pending', attempts = 0, run_after = now(), locked_until = NULL,
           token_hash = NULL, expires_at = NULL, error = NULL, finished_at = NULL, created_at = now(),
           sends = recap_requests.sends + CASE WHEN recap_requests.status = 'pending' THEN 0 ELSE 1 END`,
        [p.id, p.sessionId, email],
      );
    });
    this.onQueued();
    return this.status(p);
  }

  /** Whose files an emailed link opens; null when it's wrong, replaced or expired. */
  async participantFor(token: string): Promise<(Participant & { showName: string }) | null> {
    const [row] = await this.db.query<{ id: string; session_id: string; role: Participant["role"]; show_name: string }>(
      `SELECT p.id, p.session_id, p.role, st.name AS show_name
       FROM recap_requests q JOIN participants p ON p.id = q.participant_id
       JOIN sessions s ON s.id = p.session_id JOIN studios st ON st.id = s.studio_id
       WHERE q.token_hash = $1 AND q.status = 'sent' AND q.expires_at > now() AND st.deleted_at IS NULL`,
      [hashToken(token)],
    );
    return row ? { id: row.id, sessionId: row.session_id, role: row.role, showName: row.show_name } : null;
  }

  /** The show lets guests have their files, and this person recorded something still here. */
  private async allowed(p: Participant) {
    const [row] = await this.db.query<{ settings: unknown }>(
      `SELECT st.settings FROM sessions s JOIN studios st ON st.id = s.studio_id
       WHERE s.id = $1 AND st.deleted_at IS NULL AND EXISTS (
         SELECT 1 FROM tracks t JOIN recordings r ON r.id = t.recording_id
         WHERE t.participant_id = $2 AND r.session_id = s.id AND r.deleted_at IS NULL)`,
      [p.sessionId, p.id],
    );
    return !!row && studioSettings.parse(row.settings).guestDownloads;
  }
}

interface Due {
  participant_id: string;
  session_id: string;
  email: string;
  attempts: number;
  show_name: string;
  settings: unknown;
  has_files: boolean;
}

/**
 * Send every recap whose files have settled. Run by the job runner, so a separate worker does
 * this too. Sends at least once: a crash just after sending can mean a second mail, never none.
 */
export async function sendDueRecaps(db: Db, mail: RecapMail) {
  for (;;) {
    const token = newToken();
    const due = await claim(db, token);
    if (!due) return;
    if (!due.has_files || !studioSettings.parse(due.settings).guestDownloads) {
      await giveUp(db, due, token, "NO_FILES");
      continue;
    }
    try {
      await mail.mailer.send(recapMessage(due.email, due.show_name, `${mail.appUrl.replace(/\/$/, "")}/recap/${token}`, mail.promoUrl));
      // token_hash only matches if the guest didn't change the address meanwhile; then the new one is still due.
      await db.query(
        `UPDATE recap_requests SET status = 'sent', email = NULL, error = NULL, finished_at = now(), locked_until = NULL,
                expires_at = now() + make_interval(days => $3)
         WHERE participant_id = $1 AND token_hash = $2`,
        [due.participant_id, hashToken(token), RECAP_LINK_DAYS],
      );
    } catch (err) {
      const reason = mailFailureReason(err);
      console.error(`[recap] sending for ${due.participant_id} attempt ${due.attempts} failed: ${reason}`);
      if (due.attempts >= MAX_ATTEMPTS) {
        await giveUp(db, due, token, reason);
      } else {
        await db.query(
          `UPDATE recap_requests SET locked_until = NULL, error = $3, run_after = now() + make_interval(secs => $4)
           WHERE participant_id = $1 AND token_hash = $2`,
          [due.participant_id, hashToken(token), reason, Math.min(3600, 60 * 2 ** due.attempts)],
        );
      }
    }
  }
}

/** The next recap to send, with a fresh link token. Every episode they're in must have settled. */
async function claim(db: Db, token: string): Promise<Due | null> {
  return db.transaction(async (tx) => {
    const [due] = await tx.query<Due>(
      `SELECT q.participant_id, q.session_id, q.email, q.attempts, st.name AS show_name, st.settings,
              EXISTS (SELECT 1 FROM outputs o JOIN recordings r ON r.id = o.recording_id
                      WHERE o.participant_id = q.participant_id AND r.deleted_at IS NULL AND r.processing = 'ready'
                        AND o.kind IN ('audio', 'video')) AS has_files
       FROM recap_requests q
       JOIN sessions s ON s.id = q.session_id JOIN studios st ON st.id = s.studio_id
       WHERE q.status = 'pending' AND q.run_after <= now() AND q.attempts < $1
         AND (q.locked_until IS NULL OR q.locked_until < now())
         AND NOT EXISTS (SELECT 1 FROM recordings r JOIN tracks t ON t.recording_id = r.id
                         WHERE t.participant_id = q.participant_id AND r.deleted_at IS NULL AND r.processing NOT IN ('ready', 'failed'))
       ORDER BY q.created_at LIMIT 1 FOR UPDATE OF q SKIP LOCKED`,
      [MAX_ATTEMPTS],
    );
    if (!due) return null;
    await tx.query(
      `UPDATE recap_requests SET attempts = attempts + 1, token_hash = $2, locked_until = now() + make_interval(secs => $3)
       WHERE participant_id = $1`,
      [due.participant_id, hashToken(token), LOCK_SECONDS],
    );
    return { ...due, attempts: due.attempts + 1 };
  });
}

/** Giving up: the address goes, and the end screen says so. */
function giveUp(db: Db, due: Due, token: string, error: string) {
  return db.query(
    `UPDATE recap_requests SET status = 'failed', email = NULL, token_hash = NULL, error = $3, finished_at = now(), locked_until = NULL
     WHERE participant_id = $1 AND token_hash = $2`,
    [due.participant_id, hashToken(token), error],
  );
}

/** Drop what has run its course, addresses included. */
export async function sweepRecaps(db: Db) {
  await db.query(
    `DELETE FROM recap_requests
     WHERE (status = 'pending' AND created_at < now() - make_interval(days => $1))
        OR (status = 'sent' AND expires_at < now())
        OR (status = 'failed' AND finished_at < now() - make_interval(days => $1))`,
    [RECAP_LINK_DAYS],
  );
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function recapMessage(to: string, showName: string, link: string, promoUrl: string | null) {
  const promo = promoUrl ? `Record your own, free: ${promoUrl}` : null;
  const text = [
    `Your recording from ${showName} is ready.`,
    `Download it here: ${link}`,
    `This link is just for you and works for ${RECAP_LINK_DAYS} days. We won't email you again about it, and we don't keep your address.`,
    ...(promo ? [promo] : []),
  ].join("\n\n");
  const p = 'style="margin:0 0 16px;font:16px/1.5 system-ui,sans-serif;color:#222"';
  const html = [
    `<p ${p}>Your recording from <strong>${escapeHtml(showName)}</strong> is ready.</p>`,
    `<p ${p}><a href="${escapeHtml(link)}">Download your recording</a></p>`,
    `<p ${p}>This link is just for you and works for ${RECAP_LINK_DAYS} days. We won't email you again about it, and we don't keep your address.</p>`,
    ...(promoUrl ? [`<p ${p}><a href="${escapeHtml(promoUrl)}">Record your own, free</a></p>`] : []),
  ].join("\n");
  return { to, subject: `Your recording from ${showName}`, text, html };
}
