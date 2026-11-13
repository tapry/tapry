// Paddle fulfilment: verified webhooks are mirrored into `billing_customers` and
// `billing_subscriptions`, and each account's plan follows what its subscriptions grant.
// Also the customer portal: a Paddle-hosted page for the card, invoices and cancelling.
//
// Rules this file keeps:
// - Nothing is read from a webhook before Paddle's SDK has verified its signature against the
//   notification's signing secret (not the API key), on the raw body.
// - Deliveries come at least once and in any order: each event is applied once (`billing_events`),
//   and rows are upserted by Paddle's id, an older state never overwriting a newer one.
// - Access ends only when a subscription's status says so (`grantsAccess`), never because a
//   cancellation or pause is merely scheduled.
// - Nothing here deletes a Paddle entity or a mirrored row.
import { Environment, Paddle, type CustomerNotification, type EventEntity, type SubscriptionNotification, type TransactionNotification } from "@paddle/paddle-node-sdk";
import { PLANS, planRank, type PlanId } from "@tapry/shared";
import type { User } from "./auth";
import { extendKeeping } from "./billing";
import type { Db, Queryable } from "./db";
import { ApiError } from "./errors";

export interface PaddleOptions {
  /** The notification destination's signing secret ("pdl_ntfset_…"). Not the API key. */
  webhookSecret: string | null;
  /** Price id → the plan it sells (monthly and yearly prices of a plan both map to it). */
  prices: Record<string, PlanId>;
  /** The API key, for customer portal sessions. Server-side only; never sent to a browser. */
  apiKey?: string | null;
  sandbox?: boolean;
  /** Mints a portal session and returns its address. Defaults to Paddle's API; tests pass their own. */
  portal?: (customerId: string, subscriptionIds: string[]) => Promise<string>;
  /** Verifies and parses a delivery. Defaults to the SDK's `webhooks.unmarshal`; tests may pass their own. */
  unmarshal?: (rawBody: string, secret: string, signature: string) => Promise<EventEntity>;
}

/** What a delivery came to, for the log line and the response (never whose it was). */
export type WebhookResult = "applied" | "duplicate" | "stale" | "ignored" | "unlinked" | "unknown_plan";

const HANDLED = new Set(["subscription.created", "subscription.updated", "subscription.canceled", "customer.created", "customer.updated", "transaction.completed"]);

/**
 * Whether a subscription in this state gives paid access. `active` and `trialing` do. So does
 * `past_due`: Paddle is retrying the payment, and the plan stays on meanwhile (it ends when Paddle
 * cancels the subscription). `paused` and `canceled` don't. A scheduled change is not a state:
 * a subscription set to cancel at the end of its period keeps access until it is canceled.
 */
export function grantsAccess(status: string): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

interface SubscriptionRow {
  subscription_id: string;
  customer_id: string;
  account_id: string | null;
  status: string;
  price_id: string;
  product_id: string;
  plan: string | null;
  scheduled_change_action: string | null;
  scheduled_change_at: Date | null;
  current_period_start: Date | null;
  paddle_updated_at: Date;
}

export class PaddleBilling {
  private client: Paddle | null = null;

  constructor(
    private db: Db,
    private opts: PaddleOptions,
  ) {}

  /** Whether `POST /api/billing/portal` can mint sessions (an API key, or a test's own minting). */
  get portalAvailable() {
    return !!(this.opts.portal || this.opts.apiKey);
  }

  private sdk() {
    // The key is only used to call Paddle's API (portal sessions). Verifying a webhook needs none,
    // and the SDK object makes no request when it is created.
    return (this.client ??= new Paddle(this.opts.apiKey ?? "no-api-key", { environment: this.opts.sandbox ? Environment.sandbox : Environment.production }));
  }

  // ── Webhooks ──────────────────────────────────────────────────────────────

  /**
   * One delivery: verify, then apply. Throws ApiError 401 when the signature doesn't verify (so
   * Paddle sees a failure and retries), 400 when a verified body can't be read. Any other error
   * propagates as a 5xx, so Paddle retries; the transaction it ran in leaves nothing half-applied.
   */
  async handleWebhook(rawBody: string, signature: string | null): Promise<{ type: string; result: WebhookResult }> {
    const secret = this.opts.webhookSecret;
    if (!secret) throw new ApiError(404, "not_found", "Not found");
    if (!signature) throw new ApiError(401, "bad_signature", "The webhook's signature doesn't match");
    let event: EventEntity;
    try {
      event = await (this.opts.unmarshal ?? ((b, s, sig) => this.sdk().webhooks.unmarshal(b, s, sig)))(rawBody, secret, signature);
    } catch (err) {
      // The SDK throws for a signature that doesn't verify (or is too old) and for a header it
      // can't read; a body that verified but isn't an event is the only other failure here.
      const signed = await this.sdk().webhooks.isSignatureValid(rawBody, secret, signature).catch(() => false);
      if (!signed) throw new ApiError(401, "bad_signature", "The webhook's signature doesn't match");
      throw new ApiError(400, "bad_webhook", err instanceof Error && err.name ? `The webhook's body couldn't be read (${err.name})` : "The webhook's body couldn't be read");
    }
    const type = event.eventType;
    if (!HANDLED.has(type)) return { type, result: "ignored" };
    const occurredAt = new Date(event.occurredAt);

    const result = await this.db.transaction(async (tx): Promise<WebhookResult> => {
      const [fresh] = await tx.query("INSERT INTO billing_events (id) VALUES ($1) ON CONFLICT (id) DO NOTHING RETURNING id", [`paddle:${event.eventId}`]);
      if (!fresh) return "duplicate";
      switch (type) {
        case "subscription.created":
        case "subscription.updated":
        case "subscription.canceled":
          return this.onSubscription(tx, event.data as SubscriptionNotification, occurredAt);
        case "customer.created":
        case "customer.updated":
          return this.onCustomer(tx, event.data as CustomerNotification);
        case "transaction.completed":
          return this.onTransactionCompleted(tx, event.data as TransactionNotification);
        default:
          return "ignored";
      }
    });
    return { type, result };
  }

  /** The account a checkout's custom data names, if it is a real account (an owner, not a member). */
  private async accountFrom(tx: Queryable, customData: unknown): Promise<string | null> {
    const id = (customData as { user_id?: unknown } | null)?.user_id;
    if (typeof id !== "string" || !id) return null;
    const [row] = await tx.query<{ id: string }>("SELECT id FROM users WHERE id = $1 AND account_id IS NULL", [id]);
    return row?.id ?? null;
  }

  /** A customer row, created bare when a subscription or transaction mentions one before its own event arrives. */
  private async ensureCustomer(tx: Queryable, customerId: string, accountId: string | null) {
    await tx.query(
      `INSERT INTO billing_customers (customer_id, account_id) VALUES ($1, $2)
       ON CONFLICT (customer_id) DO UPDATE SET account_id = coalesce(billing_customers.account_id, EXCLUDED.account_id), updated_at = now()`,
      [customerId, accountId],
    );
  }

  private async onCustomer(tx: Queryable, c: CustomerNotification): Promise<WebhookResult> {
    const updatedAt = new Date(c.updatedAt);
    const [row] = await tx.query<{ customer_id: string }>(
      `INSERT INTO billing_customers (customer_id, email, account_id, paddle_updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (customer_id) DO UPDATE SET email = EXCLUDED.email, paddle_updated_at = EXCLUDED.paddle_updated_at,
              account_id = coalesce(billing_customers.account_id, EXCLUDED.account_id), updated_at = now()
         WHERE billing_customers.paddle_updated_at IS NULL OR billing_customers.paddle_updated_at <= EXCLUDED.paddle_updated_at
       RETURNING customer_id`,
      [c.id, c.email, await this.accountFrom(tx, c.customData), updatedAt],
    );
    return row ? "applied" : "stale";
  }

  /** A completed payment ties its customer (and subscription) to the account the checkout named. */
  private async onTransactionCompleted(tx: Queryable, t: TransactionNotification): Promise<WebhookResult> {
    if (!t.customerId) return "ignored";
    const account = await this.accountFrom(tx, t.customData);
    await this.ensureCustomer(tx, t.customerId, account);
    if (!account || !t.subscriptionId) return account ? "applied" : "unlinked";
    // The subscription event may have come first, without an account it could use.
    const linked = await tx.query<{ subscription_id: string }>(
      "UPDATE billing_subscriptions SET account_id = $2, updated_at = now() WHERE subscription_id = $1 AND account_id IS NULL RETURNING subscription_id",
      [t.subscriptionId, account],
    );
    if (linked.length > 0) await this.syncAccount(tx, account);
    return "applied";
  }

  private async onSubscription(tx: Queryable, s: SubscriptionNotification, occurredAt: Date): Promise<WebhookResult> {
    const price = s.items.find((i) => i.price)?.price ?? null;
    const plan = price ? (this.opts.prices[price.id] ?? null) : null;
    const updatedAt = new Date(s.updatedAt || occurredAt);
    const [known] = await tx.query<SubscriptionRow>("SELECT * FROM billing_subscriptions WHERE subscription_id = $1 FOR UPDATE", [s.id]);
    if (known && known.paddle_updated_at.getTime() > updatedAt.getTime()) return "stale";

    const account = (await this.accountFrom(tx, s.customData)) ?? known?.account_id ?? (await this.customerAccount(tx, s.customerId));
    await this.ensureCustomer(tx, s.customerId, account);
    await tx.query(
      `INSERT INTO billing_subscriptions (subscription_id, customer_id, account_id, status, price_id, product_id, plan,
              scheduled_change_action, scheduled_change_at, current_period_start, current_period_end, paddle_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (subscription_id) DO UPDATE SET customer_id = EXCLUDED.customer_id, account_id = coalesce(EXCLUDED.account_id, billing_subscriptions.account_id),
              status = EXCLUDED.status, price_id = EXCLUDED.price_id, product_id = EXCLUDED.product_id, plan = EXCLUDED.plan,
              scheduled_change_action = EXCLUDED.scheduled_change_action, scheduled_change_at = EXCLUDED.scheduled_change_at,
              current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end,
              paddle_updated_at = EXCLUDED.paddle_updated_at, updated_at = now()`,
      [
        s.id,
        s.customerId,
        account,
        s.status,
        price?.id ?? "",
        price?.productId ?? "",
        plan,
        s.scheduledChange?.action ?? null,
        s.scheduledChange?.effectiveAt ? new Date(s.scheduledChange.effectiveAt) : null,
        s.currentBillingPeriod?.startsAt ? new Date(s.currentBillingPeriod.startsAt) : null,
        s.currentBillingPeriod?.endsAt ? new Date(s.currentBillingPeriod.endsAt) : null,
        updatedAt,
      ],
    );
    if (!account) return "unlinked";
    await this.syncAccount(tx, account);
    return plan ? "applied" : "unknown_plan";
  }

  private async customerAccount(tx: Queryable, customerId: string) {
    const [row] = await tx.query<{ account_id: string | null }>("SELECT account_id FROM billing_customers WHERE customer_id = $1", [customerId]);
    return row?.account_id ?? null;
  }

  /**
   * Set the account's plan from its mirrored subscriptions: the biggest plan among those that
   * grant access. When none does any more, an account that was on a subscription goes back to
   * Free; one on a plan set by hand (never subscribed) is left as it is.
   */
  private async syncAccount(tx: Queryable, accountId: string) {
    const [user] = await tx.query<{ billing_subscription: string | null }>("SELECT billing_subscription FROM users WHERE id = $1 FOR UPDATE", [accountId]);
    if (!user) return;
    const subs = await tx.query<SubscriptionRow>("SELECT * FROM billing_subscriptions WHERE account_id = $1", [accountId]);
    const granting = subs.filter((s) => grantsAccess(s.status) && s.plan && s.plan in PLANS);
    const best = granting.sort((a, b) => planRank(b.plan as PlanId) - planRank(a.plan as PlanId))[0];
    if (!best) {
      if (user.billing_subscription) {
        await tx.query(
          `UPDATE users SET plan = 'free', plan_status = 'active', plan_ends_at = NULL, plan_period_start = NULL,
                  billing_subscription = NULL, billing_updated_at = now() WHERE id = $1`,
          [accountId],
        );
      }
      return;
    }
    const status = best.status === "past_due" ? "past_due" : best.scheduled_change_action === "cancel" ? "canceled" : "active";
    await tx.query(
      // plan_ends_at stays empty for a subscription: it ends when Paddle cancels it, not at a date we guess.
      `UPDATE users SET plan = $2, plan_status = $3, plan_ends_at = NULL, plan_period_start = coalesce($4, plan_period_start),
              billing_customer = $5, billing_subscription = $6, billing_updated_at = now() WHERE id = $1`,
      [accountId, best.plan, status, best.current_period_start, best.customer_id, best.subscription_id],
    );
    await extendKeeping(tx, accountId, PLANS[best.plan as PlanId]);
  }

  /** The scheduled change of the account's current subscription, for the Plan tab. */
  async scheduledChange(accountId: string): Promise<{ action: string; at: Date } | null> {
    const [row] = await this.db.query<{ action: string | null; at: Date | null }>(
      `SELECT s.scheduled_change_action AS action, s.scheduled_change_at AS at
       FROM users u JOIN billing_subscriptions s ON s.subscription_id = u.billing_subscription WHERE u.id = $1`,
      [accountId],
    );
    return row?.action && row.at ? { action: row.action, at: row.at } : null;
  }

  // ── Customer portal ───────────────────────────────────────────────────────

  /**
   * A portal session for the signed-in account's Paddle customer, minted server-side. The
   * customer id comes from our database, from the account the session belongs to; nothing the
   * browser sends is used to pick it. The account's owner only: the card and invoices are theirs.
   */
  async portalUrl(user: User): Promise<string> {
    if (!this.portalAvailable) throw new ApiError(404, "not_found", "Not found");
    if (user.accountId !== user.id) throw new ApiError(403, "owner_only", "Only the account's owner can manage its billing");
    const [account] = await this.db.query<{ billing_customer: string | null }>("SELECT billing_customer FROM users WHERE id = $1", [user.accountId]);
    const customerId = account?.billing_customer ?? (await this.customerOfAccount(user.accountId));
    if (!customerId) throw new ApiError(404, "no_customer", "There's nothing to manage yet: this account hasn't paid for a plan");
    const subs = await this.db.query<{ subscription_id: string }>(
      "SELECT subscription_id FROM billing_subscriptions WHERE customer_id = $1 AND account_id = $2 AND status <> 'canceled' ORDER BY created_at",
      [customerId, user.accountId],
    );
    const ids = subs.map((s) => s.subscription_id);
    if (this.opts.portal) return this.opts.portal(customerId, ids);
    const session = await this.sdk().customerPortalSessions.create(customerId, ids);
    return session.urls.general.overview;
  }

  private async customerOfAccount(accountId: string) {
    const [row] = await this.db.query<{ customer_id: string }>("SELECT customer_id FROM billing_customers WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1", [accountId]);
    return row?.customer_id ?? null;
  }
}
