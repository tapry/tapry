// Tapry Cloud: plans, what a host has used of theirs, and what a payment provider tells us.
// Off unless the server runs with TAPRY_CLOUD=true: a self-hosted server has no plans, no
// limits and none of these endpoints (they answer 404).
import { PLANS, PLAN_IDS, planRank, type BillingOverview, type Plan, type PlanId, type PlanStatus } from "@tapry/shared";
import type { User } from "./auth";
import type { Db, Queryable } from "./db";
import { ApiError } from "./errors";
import { mailFailureReason, type Mailer, type MailMessage } from "./mail";

const DAY_MS = 86_400_000;

export interface BillingOptions {
  /** This server is Tapry Cloud. False (default): everything here is off. */
  cloud: boolean;
  /**
   * Where each plan is bought: a checkout address with `{user_id}` and `{email}` filled in, so
   * the provider's webhook can say whose subscription it is. A plan without one can't be bought here.
   */
  checkoutUrls?: Partial<Record<PlanId, string>>;
  /** The provider's customer portal (card, invoices, cancelling). */
  manageUrl?: string | null;
  now?: () => number;
}

/** What a payment provider's webhook comes down to, whichever provider sent it. */
export interface BillingEvent {
  /** The provider's id for this event: one event is applied once. */
  id: string;
  /** Our user id, as passed to the checkout. */
  userId: string | null;
  /** The plan the subscription's price stands for; null when the price isn't one of ours. */
  plan: PlanId | null;
  /** ended: the subscription is over (the account goes back to Free now). */
  status: PlanStatus | "ended";
  /** The start of the current billing month: recording hours count from it. */
  periodStart: Date | null;
  /** When a canceled subscription stops. */
  endsAt: Date | null;
  customer: string | null;
  subscription: string | null;
  /** When the provider says this happened: an older event never overwrites a newer one. */
  occurredAt: Date;
}

interface PlanRow {
  plan: string;
  plan_status: string;
  plan_ends_at: Date | null;
  plan_period_start: Date | null;
  billing_subscription: string | null;
}

const PLAN_COLUMNS = "plan, plan_status, plan_ends_at, plan_period_start, billing_subscription";

/** The plan an account has right now: a plan past its end is Free. */
export function effectivePlan(row: Pick<PlanRow, "plan" | "plan_ends_at">, now: number): Plan {
  const known = (PLAN_IDS as readonly string[]).includes(row.plan) ? PLANS[row.plan as PlanId] : PLANS.free;
  if (row.plan_ends_at && row.plan_ends_at.getTime() <= now) return PLANS.free;
  return known;
}

/**
 * The billing month `now` falls in. With a subscription it starts on the day of the month the
 * subscription did (the 31st becomes a month's last day); without one it is the calendar month, UTC.
 */
export function billingPeriod(anchor: Date | null, now: number): { start: number; end: number } {
  const n = new Date(now);
  if (!anchor || anchor.getTime() > now) {
    return { start: Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1), end: Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1) };
  }
  const at = (months: number) => {
    const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(anchor.getUTCDate(), lastDay),
      anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds());
  };
  let months = (n.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (n.getUTCMonth() - anchor.getUTCMonth());
  if (at(months) > now) months -= 1;
  return { start: at(months), end: at(months + 1) };
}

/** The plan of the host who owns a recording, for the worker (which has no BillingService). */
export async function planOfRecording(db: Queryable, recordingId: string, now: number): Promise<Plan> {
  const [row] = await db.query<PlanRow>(
    `SELECT u.plan, u.plan_status, u.plan_ends_at, u.plan_period_start, u.billing_subscription
     FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id JOIN users u ON u.id = st.owner_id
     WHERE r.id = $1`,
    [recordingId],
  );
  return row ? effectivePlan(row, now) : PLANS.free;
}

/**
 * A recording's files are ready (Tapry Cloud): note until when its host's plan keeps them, and
 * say how long the original uploads stay (undefined: kept).
 */
export async function planRetention(tx: Queryable, recordingId: string, now: number): Promise<number | undefined> {
  const plan = await planOfRecording(tx, recordingId, now);
  if (plan.filesDays !== null) {
    await tx.query("UPDATE recordings SET keep_until = coalesce(keep_until, now() + make_interval(secs => $2)) WHERE id = $1", [
      recordingId,
      plan.filesDays * 86_400,
    ]);
  }
  return plan.originalsDays === null ? undefined : plan.originalsDays * DAY_MS;
}

/** Whether a session's host is on a plan with the "Recorded with Tapry" badge (Tapry Cloud's Free). */
export async function sessionHasBadge(db: Queryable, sessionId: string, now: number): Promise<boolean> {
  const [row] = await db.query<PlanRow>(
    `SELECT u.plan, u.plan_status, u.plan_ends_at, u.plan_period_start, u.billing_subscription
     FROM sessions s JOIN studios st ON st.id = s.studio_id JOIN users u ON u.id = st.owner_id WHERE s.id = $1`,
    [sessionId],
  );
  return !!row && effectivePlan(row, now).badge;
}

/**
 * The "Record your own, free" link guests of a session see, or null for none. On a self-hosted
 * server it is the server's own setting; on Tapry Cloud only the Free plan carries it.
 */
export async function promoFor(db: Queryable, sessionId: string, opts: { cloud: boolean; promoUrl: string | null }, now = Date.now()) {
  if (!opts.promoUrl) return null;
  if (!opts.cloud) return opts.promoUrl;
  return (await sessionHasBadge(db, sessionId, now)) ? opts.promoUrl : null;
}

export class BillingService {
  private now: () => number;

  constructor(
    private db: Db,
    private opts: BillingOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** Whether this server is Tapry Cloud. */
  get cloud() {
    return this.opts.cloud;
  }

  private requireCloud() {
    if (!this.opts.cloud) throw new ApiError(404, "not_found", "Not found");
  }

  private async row(userId: string): Promise<PlanRow> {
    const [row] = await this.db.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM users WHERE id = $1`, [userId]);
    if (!row) throw new ApiError(404, "user_not_found", "No such account");
    return row;
  }

  /** The plan an account is on right now. */
  async planOf(userId: string, db: Queryable = this.db): Promise<Plan> {
    const [row] = await db.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM users WHERE id = $1`, [userId]);
    return row ? effectivePlan(row, this.now()) : PLANS.free;
  }

  /** Milliseconds a host has recorded since `from`: every recording of theirs, deleted ones too, running ones up to now. */
  private async usedMs(ownerId: string, from: number): Promise<number> {
    const [row] = await this.db.query<{ ms: string }>(
      `SELECT coalesce(sum(greatest(coalesce(r.stopped_at, $3) - r.started_at, 0)), 0)::bigint AS ms
       FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE st.owner_id = $1 AND r.started_at >= $2`,
      [ownerId, from, this.now()],
    );
    return Number(row?.ms ?? 0);
  }

  /** A host's plan and what they have used of it this billing month. */
  async overview(user: User): Promise<BillingOverview> {
    this.requireCloud();
    const row = await this.row(user.id);
    const now = this.now();
    const plan = effectivePlan(row, now);
    // A plan that has ended counts by the calendar month again, like Free.
    const period = billingPeriod(plan.id === "free" ? null : row.plan_period_start, now);
    const upgrades = PLAN_IDS.filter((id) => planRank(id) > planRank(plan.id) && this.opts.checkoutUrls?.[id]).map((id) => ({
      plan: PLANS[id],
      url: this.opts.checkoutUrls![id]!.replaceAll("{user_id}", encodeURIComponent(user.id)).replaceAll("{email}", encodeURIComponent(user.email)),
    }));
    return {
      plan,
      status: plan.id === "free" ? "active" : (row.plan_status as PlanStatus),
      endsAt: plan.id === "free" ? null : (row.plan_ends_at?.toISOString() ?? null),
      periodStart: new Date(period.start).toISOString(),
      periodEnd: new Date(period.end).toISOString(),
      usedMs: await this.usedMs(user.id, period.start),
      upgrades,
      manageUrl: row.billing_subscription ? (this.opts.manageUrl ?? null) : null,
    };
  }

  /**
   * Before a recording starts in a session: refuse when its host's hours for this billing month
   * are used up. Only ever before Record: a recording that is running is never stopped for this.
   */
  async checkCanRecord(sessionId: string) {
    if (!this.opts.cloud) return;
    const [row] = await this.db.query<PlanRow & { id: string }>(
      `SELECT u.id, u.plan, u.plan_status, u.plan_ends_at, u.plan_period_start, u.billing_subscription
       FROM sessions s JOIN studios st ON st.id = s.studio_id JOIN users u ON u.id = st.owner_id WHERE s.id = $1`,
      [sessionId],
    );
    if (!row) return;
    const now = this.now();
    const plan = effectivePlan(row, now);
    if (plan.hours === null) return;
    const period = billingPeriod(plan.id === "free" ? null : row.plan_period_start, now);
    if ((await this.usedMs(row.id, period.start)) < plan.hours * 3_600_000) return;
    const again = new Date(period.end).toISOString().slice(0, 10);
    throw new ApiError(
      402,
      "hours_used_up",
      `This month's ${plan.hours} recording hours on the ${plan.name} plan are used up. They start again on ${again}; a bigger plan (Settings, Plan) lets you record now.`,
    );
  }

  /** The "Record your own, free" link for guests of a session (see promoFor). */
  promoFor(sessionId: string, promoUrl: string | null) {
    return promoFor(this.db, sessionId, { cloud: this.opts.cloud, promoUrl }, this.now());
  }

  /**
   * Put an account on a plan by hand (an admin: a founding member, an organisation paying by
   * invoice). Not for subscriptions: the provider's webhook keeps those.
   */
  async setPlan(admin: User, userId: string, plan: PlanId, endsAt: Date | null) {
    this.requireCloud();
    if (!admin.isAdmin) throw new ApiError(404, "not_found", "Not found");
    await this.db.transaction(async (tx) => {
      const [row] = await tx.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      if (!row) throw new ApiError(404, "user_not_found", "No such account");
      if (row.billing_subscription) {
        throw new ApiError(409, "has_subscription", "This account pays by subscription: change the plan with the payment provider");
      }
      await tx.query(
        `UPDATE users SET plan = $2, plan_status = 'active', plan_ends_at = $3, plan_period_start = $4, billing_updated_at = now() WHERE id = $1`,
        [userId, plan, endsAt, plan === "free" ? null : new Date(this.now())],
      );
      await extendKeeping(tx, userId, PLANS[plan]);
    });
  }

  /** Accounts and their plans, for the admin. */
  async accounts(admin: User): Promise<Array<{ id: string; email: string; name: string; plan: PlanId; status: PlanStatus; endsAt: string | null; subscription: boolean }>> {
    this.requireCloud();
    if (!admin.isAdmin) throw new ApiError(404, "not_found", "Not found");
    const rows = await this.db.query<PlanRow & { id: string; email: string; name: string }>(
      `SELECT id, email, name, ${PLAN_COLUMNS} FROM users ORDER BY created_at`,
    );
    const now = this.now();
    return rows.map((r) => {
      const plan = effectivePlan(r, now);
      return {
        id: r.id,
        email: r.email,
        name: r.name,
        plan: plan.id,
        status: plan.id === "free" ? "active" : (r.plan_status as PlanStatus),
        endsAt: plan.id === "free" ? null : (r.plan_ends_at?.toISOString() ?? null),
        subscription: !!r.billing_subscription,
      };
    });
  }

  /**
   * Apply what a provider's webhook said. Safe to receive twice or out of order: an event is
   * applied once, and one older than what the account already shows is dropped.
   * Returns what was done, for the webhook's log line (never the customer's details).
   */
  async apply(event: BillingEvent): Promise<"applied" | "duplicate" | "stale" | "unknown_user" | "unknown_plan"> {
    this.requireCloud();
    return this.db.transaction(async (tx) => {
      const [fresh] = await tx.query("INSERT INTO billing_events (id) VALUES ($1) ON CONFLICT (id) DO NOTHING RETURNING id", [event.id]);
      if (!fresh) return "duplicate";
      // By our id from the checkout, or by the subscription we already know.
      const [user] = await tx.query<{ id: string; billing_updated_at: Date | null; billing_subscription: string | null }>(
        `SELECT id, billing_updated_at, billing_subscription FROM users
         WHERE id = $1 OR ($2::text IS NOT NULL AND billing_subscription = $2)
         ORDER BY (id = $1) DESC LIMIT 1 FOR UPDATE`,
        [event.userId, event.subscription],
      );
      if (!user) return "unknown_user";
      if (user.billing_updated_at && user.billing_updated_at.getTime() > event.occurredAt.getTime()) return "stale";
      // Another subscription's ending (an old one, after a new one began) says nothing about this one.
      if (event.status === "ended" && user.billing_subscription && event.subscription && user.billing_subscription !== event.subscription) return "stale";

      if (event.status === "ended") {
        await tx.query(
          `UPDATE users SET plan = 'free', plan_status = 'active', plan_ends_at = NULL, plan_period_start = NULL,
                  billing_subscription = NULL, billing_updated_at = $2 WHERE id = $1`,
          [user.id, event.occurredAt],
        );
        return "applied";
      }
      if (!event.plan) return "unknown_plan";
      await tx.query(
        `UPDATE users SET plan = $2, plan_status = $3, plan_ends_at = $4, plan_period_start = coalesce($5, plan_period_start),
                billing_customer = coalesce($6, billing_customer), billing_subscription = $7, billing_updated_at = $8 WHERE id = $1`,
        [user.id, event.plan, event.status, event.status === "canceled" ? event.endsAt : null, event.periodStart, event.customer, event.subscription, event.occurredAt],
      );
      await extendKeeping(tx, user.id, PLANS[event.plan]);
      return "applied";
    });
  }
}

/**
 * A bigger plan keeps files longer, and that holds for what is already recorded. A smaller plan
 * never shortens it: what was promised when a recording was made stands.
 */
async function extendKeeping(tx: Queryable, ownerId: string, plan: Plan) {
  await tx.query(
    `UPDATE recordings r SET keep_until = CASE WHEN $2::float8 IS NULL THEN NULL ELSE r.processed_at + make_interval(secs => $2::float8) END,
            expiry_warned_at = NULL
     FROM sessions s JOIN studios st ON st.id = s.studio_id
     WHERE s.id = r.session_id AND st.owner_id = $1 AND r.deleted_at IS NULL AND r.keep_until IS NOT NULL AND r.processed_at IS NOT NULL
       AND ($2::float8 IS NULL OR r.processed_at + make_interval(secs => $2::float8) > r.keep_until)`,
    [ownerId, plan.filesDays === null ? null : (plan.filesDays * DAY_MS) / 1000],
  );
}

/** How long before its time is over a host is told about a recording. */
export const EXPIRY_WARNING_MS = 3 * DAY_MS;
/** A recording is deleted no sooner than this after its warning went out. */
export const EXPIRY_NOTICE_MS = DAY_MS;

/**
 * Tapry Cloud, where the server sends email: tell each host, in one email, which of their
 * recordings will be deleted within three days. Each recording is mentioned once (a bigger plan
 * resets that). A mail problem leaves them unmarked, so they are neither deleted nor forgotten.
 */
export async function warnExpiring(db: Db, mail: { mailer: Mailer; appUrl: string }) {
  const rows = await db.query<{ id: string; number: number | null; keep_until: Date; studio_name: string; email: string; name: string; owner_id: string }>(
    `SELECT r.id, r.number, r.keep_until, st.name AS studio_name, u.email, u.name, u.id AS owner_id
     FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id JOIN users u ON u.id = st.owner_id
     WHERE r.keep_until IS NOT NULL AND r.keep_until < now() + make_interval(secs => $1) AND r.expiry_warned_at IS NULL
       AND r.deleted_at IS NULL AND r.status = 'stopped'
     ORDER BY u.id, r.keep_until LIMIT 500`,
    [EXPIRY_WARNING_MS / 1000],
  );
  const byOwner = new Map<string, typeof rows>();
  for (const r of rows) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r]);
  for (const list of byOwner.values()) {
    try {
      await mail.mailer.send(expiryMessage(list[0]!.email, list[0]!.name, list, mail.appUrl));
      await db.query("UPDATE recordings SET expiry_warned_at = now() WHERE id = ANY($1) AND expiry_warned_at IS NULL", [list.map((r) => r.id)]);
    } catch (err) {
      // By its code only: the message can quote the address.
      console.error(`[billing] expiry warning not sent: ${mailFailureReason(err)}`);
    }
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function expiryMessage(
  to: string,
  name: string,
  recordings: Array<{ id: string; number: number | null; keep_until: Date; studio_name: string }>,
  appUrl: string,
): MailMessage {
  const base = appUrl.replace(/\/$/, "");
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const one = recordings.length === 1;
  const intro = `${one ? "A recording" : `${recordings.length} recordings`} of yours will be deleted soon, because ${one ? "its" : "their"} time under your plan is nearly over.`;
  const outro = "Download what you want to keep, or move to a bigger plan (Settings, Plan), which keeps recordings longer, these included.";
  const label = (r: (typeof recordings)[number]) => `${r.studio_name}, recording ${r.number ?? "?"}: deleted after ${day(r.keep_until)}`;
  const p = 'style="margin:0 0 16px;font:16px/1.5 system-ui,sans-serif;color:#222"';
  return {
    to,
    subject: one ? "A recording will be deleted soon" : `${recordings.length} recordings will be deleted soon`,
    text: [`Hello ${name},`, intro, ...recordings.map((r) => `- ${label(r)}\n  ${base}/recordings/${r.id}`), outro].join("\n\n"),
    html: [
      `<p ${p}>Hello ${escapeHtml(name)},</p>`,
      `<p ${p}>${intro}</p>`,
      `<ul ${p}>${recordings.map((r) => `<li><a href="${escapeHtml(`${base}/recordings/${r.id}`)}">${escapeHtml(label(r))}</a></li>`).join("")}</ul>`,
      `<p ${p}>${outro}</p>`,
    ].join("\n"),
  };
}
