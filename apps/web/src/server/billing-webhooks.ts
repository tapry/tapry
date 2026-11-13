// Payment providers' webhooks, read into one shape (BillingEvent). Both are merchants of
// record: they sell the subscription and tell us about it; no card detail ever reaches this server.
//
// Written from the providers' published formats and tested against payloads of that shape.
// Neither has been run against a live account yet: check with the provider's test mode first.
import type { PlanId } from "@tapry/shared";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingEvent } from "./billing";
import { ApiError } from "./errors";

export type BillingProvider = "paddle" | "lemonsqueezy";

export interface WebhookConfig {
  provider: BillingProvider;
  /** The webhook's signing secret, from the provider's dashboard. */
  secret: string;
  /** The provider's price ids (Paddle `pri_…`, Lemon Squeezy variant ids) and the plan each sells. */
  prices: Record<string, PlanId>;
  /** How old a signed Paddle request may be (it signs its timestamp). */
  maxAgeMs?: number;
}

const badSignature = () => new ApiError(401, "bad_signature", "The webhook's signature doesn't match");

function sameHex(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
const text = (v: unknown) => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

/** A webhook request → the event it carries, or null for one we don't act on. Throws 401 on a bad signature. */
export function readWebhook(cfg: WebhookConfig, rawBody: string, headers: Headers, now: number): BillingEvent | null {
  return cfg.provider === "paddle" ? readPaddle(cfg, rawBody, headers, now) : readLemonSqueezy(cfg, rawBody, headers);
}

/**
 * Paddle Billing. Header `Paddle-Signature: ts=<unix seconds>;h1=<hex>`, where h1 is
 * HMAC-SHA256(secret, "<ts>:<raw body>"). Events `subscription.*` carry the subscription.
 */
function readPaddle(cfg: WebhookConfig, rawBody: string, headers: Headers, now: number): BillingEvent | null {
  const parts = Object.fromEntries((headers.get("paddle-signature") ?? "").split(";").map((p) => p.split("=") as [string, string]));
  const ts = Number(parts.ts);
  if (!parts.h1 || !Number.isFinite(ts)) throw badSignature();
  const expected = createHmac("sha256", cfg.secret).update(`${parts.ts}:${rawBody}`).digest("hex");
  if (!sameHex(expected, parts.h1)) throw badSignature();
  if (Math.abs(now - ts * 1000) > (cfg.maxAgeMs ?? 5 * 60_000)) throw badSignature();

  const body = JSON.parse(rawBody) as { event_id?: unknown; event_type?: unknown; occurred_at?: unknown; data?: Record<string, any> };
  const type = text(body.event_type);
  const sub = body.data;
  if (!type?.startsWith("subscription.") || !sub) return null;
  const id = text(body.event_id);
  const occurredAt = date(body.occurred_at);
  if (!id || !occurredAt) return null;
  const price = text(sub.items?.[0]?.price?.id);
  const cancelAt = sub.scheduled_change?.action === "cancel" ? date(sub.scheduled_change.effective_at) : null;
  const status = text(sub.status);
  return {
    id: `paddle:${id}`,
    userId: text(sub.custom_data?.user_id),
    plan: (price && cfg.prices[price]) || null,
    status:
      status === "canceled" || status === "paused" ? "ended"
      : status === "past_due" ? "past_due"
      : cancelAt ? "canceled"
      : "active",
    periodStart: date(sub.current_billing_period?.starts_at),
    endsAt: cancelAt,
    customer: text(sub.customer_id),
    subscription: text(sub.id),
    occurredAt,
  };
}

/**
 * Lemon Squeezy. Header `X-Signature`: hex HMAC-SHA256(secret, raw body). Events
 * `subscription_*`, with what the checkout was given in `meta.custom_data`.
 */
function readLemonSqueezy(cfg: WebhookConfig, rawBody: string, headers: Headers): BillingEvent | null {
  const expected = createHmac("sha256", cfg.secret).update(rawBody).digest("hex");
  if (!sameHex(expected, headers.get("x-signature") ?? "")) throw badSignature();

  const body = JSON.parse(rawBody) as { meta?: Record<string, any>; data?: { id?: unknown; attributes?: Record<string, any> } };
  const type = text(body.meta?.event_name);
  const a = body.data?.attributes;
  // Payment events repeat what the subscription events say.
  if (!type?.startsWith("subscription_") || type.startsWith("subscription_payment_") || !a) return null;
  const subscription = text(body.data?.id);
  const occurredAt = date(a.updated_at);
  if (!subscription || !occurredAt) return null;
  const variant = text(a.variant_id);
  const status = text(a.status);
  return {
    // It sends no event id: the same subscription, kind and moment is the same event.
    id: `lemonsqueezy:${subscription}:${type}:${occurredAt.toISOString()}`,
    userId: text(body.meta?.custom_data?.user_id),
    plan: (variant && cfg.prices[variant]) || null,
    status:
      status === "expired" || status === "paused" || status === "unpaid" ? "ended"
      : status === "past_due" ? "past_due"
      : status === "cancelled" ? "canceled"
      : "active",
    // It gives the next renewal, not the period's start: the subscription's first day sets the day of the month.
    periodStart: date(a.created_at),
    endsAt: status === "cancelled" ? date(a.ends_at) : null,
    customer: text(a.customer_id),
    subscription,
    occurredAt,
  };
}
