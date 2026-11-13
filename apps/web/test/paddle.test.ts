// Paddle fulfilment: webhooks verified by Paddle's own SDK on the raw body, mirrored into
// billing_customers and billing_subscriptions, and the account's plan following them. Payloads
// have the shape Paddle sends (snake_case, full objects), signed the way Paddle signs them.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { WebhookConfig } from "../src/server/billing-webhooks";
import { grantsAccess } from "../src/server/paddle";
import { createServer, expectOk, FakeStorage } from "./harness";

const SECRET = "pdl_ntfset_test_signing_secret";
const PRICES = { pri_creator_m: "creator", pri_creator_y: "creator", pri_studio_m: "studio", pri_team_m: "team" } as const;
const WEBHOOK: WebhookConfig = { provider: "paddle", secret: SECRET, prices: PRICES };
const ORIGIN = { origin: "https://app.test" };
const DAY = 86_400_000;

let seq = 0;
const iso = (ms: number) => new Date(ms).toISOString();

/** A delivery as Paddle signs it: `Paddle-Signature: ts=<unix seconds>;h1=HMAC-SHA256(secret, "<ts>:<raw body>")`. */
function signed(event: object, opts: { secret?: string; ts?: number } = {}) {
  const body = JSON.stringify(event);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const h1 = createHmac("sha256", opts.secret ?? SECRET).update(`${ts}:${body}`).digest("hex");
  return { body, headers: new Headers({ "paddle-signature": `ts=${ts};h1=${h1}`, "content-type": "application/json" }) };
}

const envelope = (type: string, data: object, occurredAt = Date.now()) => ({ event_id: `evt_${++seq}`, event_type: type, occurred_at: iso(occurredAt), notification_id: `ntf_${seq}`, data });

const price = (id: string, interval: "month" | "year" = "month") => ({
  id,
  product_id: `pro_${id}`,
  description: id,
  type: "standard",
  name: null,
  billing_cycle: { interval, frequency: 1 },
  trial_period: null,
  tax_mode: "account_setting",
  unit_price: { amount: "1900", currency_code: "USD" },
  unit_price_overrides: [],
  quantity: { minimum: 1, maximum: 1 },
  status: "active",
  custom_data: null,
  import_meta: null,
  created_at: iso(Date.now() - 30 * DAY),
  updated_at: iso(Date.now() - 30 * DAY),
});

/** A subscription entity. `updated` sets its updated_at (ms), the order Paddle's state changed in. */
function subscription(o: { id?: string; status?: string; priceId?: string; userId?: string | null; customer?: string; cancelAt?: number | null; updated?: number; periodStart?: number }) {
  const now = o.updated ?? Date.now();
  const start = o.periodStart ?? now - DAY;
  return {
    id: o.id ?? "sub_1",
    status: o.status ?? "active",
    customer_id: o.customer ?? "ctm_1",
    address_id: "add_1",
    business_id: null,
    currency_code: "USD",
    created_at: iso(start),
    updated_at: iso(now),
    started_at: iso(start),
    first_billed_at: iso(start),
    next_billed_at: iso(start + 30 * DAY),
    paused_at: null,
    canceled_at: o.status === "canceled" ? iso(now) : null,
    discount: null,
    collection_mode: "automatic",
    billing_details: null,
    current_billing_period: { starts_at: iso(start), ends_at: iso(start + 30 * DAY) },
    billing_cycle: { interval: "month", frequency: 1 },
    scheduled_change: o.cancelAt ? { action: "cancel", effective_at: iso(o.cancelAt), resume_at: null } : null,
    items: [
      { status: "active", quantity: 1, recurring: true, created_at: iso(start), updated_at: iso(now), previously_billed_at: iso(start), next_billed_at: iso(start + 30 * DAY), trial_dates: null, price: price(o.priceId ?? "pri_creator_m"), product: null },
    ],
    custom_data: o.userId === null ? null : { user_id: o.userId },
    import_meta: null,
  };
}

const customer = (o: { id?: string; email: string; updated?: number }) => ({
  id: o.id ?? "ctm_1",
  name: null,
  email: o.email,
  marketing_consent: false,
  status: "active",
  custom_data: null,
  locale: "en",
  created_at: iso(Date.now() - DAY),
  updated_at: iso(o.updated ?? Date.now()),
  import_meta: null,
});

const transaction = (o: { userId: string; customer?: string; subscription?: string | null }) => ({
  id: `txn_${++seq}`,
  status: "completed",
  customer_id: o.customer ?? "ctm_1",
  address_id: "add_1",
  business_id: null,
  custom_data: { user_id: o.userId },
  currency_code: "USD",
  origin: "web",
  subscription_id: o.subscription === undefined ? "sub_1" : o.subscription,
  invoice_id: null,
  invoice_number: null,
  collection_mode: "automatic",
  discount_id: null,
  billing_details: null,
  billing_period: null,
  items: [{ price: price("pri_creator_m"), quantity: 1, proration: null }],
  details: null,
  payments: [],
  checkout: null,
  created_at: iso(Date.now()),
  updated_at: iso(Date.now()),
  billed_at: iso(Date.now()),
  revised_at: null,
});

async function server(opts: { portal?: (customerId: string, ids: string[]) => Promise<string>; apiKey?: string } = {}) {
  const minted: Array<{ customerId: string; ids: string[] }> = [];
  const t = await createServer(new FakeStorage(), {
    allowSignup: true,
    clockStart: Date.now(), // the SDK checks the signed time against the real clock
    billing: { cloud: true },
    billingWebhook: WEBHOOK,
    paddle: {
      webhookSecret: SECRET,
      prices: PRICES,
      portal:
        opts.portal ??
        (async (customerId, ids) => {
          minted.push({ customerId, ids });
          return `https://customer-portal.paddle.com/cpl_test?c=${customerId}`;
        }),
    },
  });
  const owner = t.client();
  const user = (await expectOk(owner.post("/auth/signup", { email: "owner@example.com", name: "Olu Owner", password: "correct horse battery" }))).body.user;
  const deliver = (event: object, sign: { secret?: string; ts?: number } = {}) => {
    const hook = signed(event, sign);
    return t.fetchFor()("https://app.test/api/billing/webhook", { method: "POST", body: hook.body, headers: hook.headers });
  };
  const result = async (event: object) => {
    const res = await deliver(event);
    expect(res.status).toBe(200);
    return ((await res.json()) as { result: string }).result;
  };
  const billing = async () => (await expectOk(owner.get("/billing"))).body;
  const rows = () => t.db.query<{ subscription_id: string; status: string; plan: string; account_id: string | null; scheduled_change_action: string | null }>("SELECT * FROM billing_subscriptions ORDER BY subscription_id");
  return { ...t, owner, user, deliver, result, billing, rows, minted };
}

describe("the access rule", () => {
  it("is active, trialing and past due; never paused or canceled", () => {
    expect(["active", "trialing", "past_due", "paused", "canceled"].map(grantsAccess)).toEqual([true, true, true, false, false]);
  });
});

describe("Paddle webhooks: verification", () => {
  it("refuses a wrong secret, an old signature, no signature, a changed body, with no 2xx and no state", async () => {
    const t = await server();
    const event = envelope("subscription.created", subscription({ userId: t.user.id }));
    for (const res of [
      await t.deliver(event, { secret: "the API key, not the signing secret" }),
      await t.deliver(event, { ts: Math.floor(Date.now() / 1000) - 60 }), // over the SDK's 5 seconds
      await t.fetchFor()("https://app.test/api/billing/webhook", { method: "POST", body: JSON.stringify(event), headers: new Headers() }),
      await t.fetchFor()("https://app.test/api/billing/webhook", { method: "POST", body: JSON.stringify(event), headers: new Headers({ "paddle-signature": "not a signature" }) }),
    ]) {
      expect(res.status).toBe(401);
    }
    const hook = signed(event);
    const changed = await t.fetchFor()("https://app.test/api/billing/webhook", { method: "POST", body: hook.body.replace("pri_creator_m", "pri_team_m"), headers: hook.headers });
    expect(changed.status).toBe(401);
    // The same JSON, re-serialised: verification is on the exact bytes Paddle signed.
    const reformatted = await t.fetchFor()("https://app.test/api/billing/webhook", { method: "POST", body: JSON.stringify(JSON.parse(hook.body), null, 2), headers: hook.headers });
    expect(reformatted.status).toBe(401);

    expect(await t.rows()).toEqual([]);
    expect((await t.billing()).plan.id).toBe("free");
    // A correct delivery afterwards is taken.
    expect(await t.result(event)).toBe("applied");
  });

  it("answers 400 for a verified body that isn't an event, and fails (not 2xx) when applying it breaks, so Paddle retries", async () => {
    const t = await server();
    const bad = signed({ event_id: "evt_x", event_type: "subscription.created", occurred_at: iso(Date.now()), data: { id: "sub_x" } });
    expect((await t.fetchFor()("https://app.test/api/billing/webhook", { method: "POST", body: bad.body, headers: bad.headers })).status).toBe(400);

    const event = envelope("subscription.created", subscription({ userId: t.user.id }));
    await t.db.query("ALTER TABLE billing_subscriptions RENAME TO billing_subscriptions_away");
    const failed = await t.deliver(event).catch(() => null);
    expect(failed === null || failed.status >= 500).toBe(true);
    await t.db.query("ALTER TABLE billing_subscriptions_away RENAME TO billing_subscriptions");
    // Nothing was half-applied: the retry of the same event goes through.
    expect(await t.result(event)).toBe("applied");
  });

  it("ignores event types it doesn't handle", async () => {
    const t = await server();
    expect(await t.result(envelope("subscription.paused", subscription({ userId: t.user.id, status: "paused" })))).toBe("ignored");
    expect(await t.result(envelope("price.updated", price("pri_creator_m")))).toBe("ignored");
    expect(await t.rows()).toEqual([]);
  });
});

describe("Paddle webhooks: the mirror and the plan", () => {
  it("mirrors a new subscription and its customer, and puts the account on the plan, once", async () => {
    const t = await server();
    const created = envelope("subscription.created", subscription({ userId: t.user.id }));
    expect(await t.result(created)).toBe("applied");
    expect(await t.result(created)).toBe("duplicate"); // at least once: the same event again changes nothing
    expect(await t.result(envelope("customer.created", customer({ email: "olu@payer.example" })))).toBe("applied");

    expect(await t.rows()).toMatchObject([{ subscription_id: "sub_1", status: "active", plan: "creator", account_id: t.user.id, scheduled_change_action: null }]);
    const [c] = await t.db.query<{ email: string; account_id: string }>("SELECT email, account_id FROM billing_customers");
    expect(c).toEqual({ email: "olu@payer.example", account_id: t.user.id });
    const b = await t.billing();
    expect(b).toMatchObject({ plan: { id: "creator" }, status: "active", endsAt: null, manageUrl: "/api/billing/portal" });
  });

  it("keeps access through a scheduled cancellation, and ends it only when the subscription is canceled", async () => {
    const t = await server();
    const base = Date.now();
    await t.result(envelope("subscription.created", subscription({ userId: t.user.id, priceId: "pri_studio_m", updated: base })));
    const cancelAt = base + 20 * DAY;
    expect(await t.result(envelope("subscription.updated", subscription({ userId: t.user.id, priceId: "pri_studio_m", cancelAt, updated: base + 1000 })))).toBe("applied");

    // Scheduled, not done: still Studio, shown as ending on Paddle's date. No date of ours revokes it.
    expect(await t.billing()).toMatchObject({ plan: { id: "studio" }, status: "canceled", endsAt: iso(cancelAt) });
    const [u] = await t.db.query<{ plan_ends_at: Date | null }>("SELECT plan_ends_at FROM users WHERE id = $1", [t.user.id]);
    expect(u!.plan_ends_at).toBeNull();
    t.tick(21 * DAY); // past the scheduled date (20 days), but Paddle has not said canceled yet
    expect((await t.billing()).plan.id).toBe("studio");

    expect(await t.result(envelope("subscription.canceled", subscription({ userId: t.user.id, priceId: "pri_studio_m", status: "canceled", updated: base + 2000 })))).toBe("applied");
    expect(await t.billing()).toMatchObject({ plan: { id: "free" }, endsAt: null });
    // The mirror keeps the canceled subscription: live history, never removed.
    expect(await t.rows()).toMatchObject([{ status: "canceled" }]);
  });

  it("follows a plan change and a failed payment, and keeps access while Paddle retries", async () => {
    const t = await server();
    const base = Date.now();
    await t.result(envelope("subscription.created", subscription({ userId: t.user.id, updated: base })));
    await t.result(envelope("subscription.updated", subscription({ userId: t.user.id, priceId: "pri_team_m", updated: base + 1000 })));
    expect((await t.billing()).plan.id).toBe("team");
    await t.result(envelope("subscription.updated", subscription({ userId: t.user.id, priceId: "pri_team_m", status: "past_due", updated: base + 2000 })));
    expect(await t.billing()).toMatchObject({ plan: { id: "team" }, status: "past_due" });
  });

  it("never lets an older state overwrite a newer one, whatever order deliveries arrive in", async () => {
    const t = await server();
    const base = Date.now();
    const newer = envelope("subscription.updated", subscription({ userId: t.user.id, priceId: "pri_team_m", updated: base + 5000 }));
    const older = envelope("subscription.created", subscription({ userId: t.user.id, priceId: "pri_creator_m", updated: base }));
    expect(await t.result(newer)).toBe("applied");
    expect(await t.result(older)).toBe("stale");
    expect((await t.billing()).plan.id).toBe("team");
    expect(await t.rows()).toMatchObject([{ plan: "team" }]);

    // Customers too.
    await t.result(envelope("customer.updated", customer({ email: "new@payer.example", updated: base + 5000 })));
    expect(await t.result(envelope("customer.created", customer({ email: "old@payer.example", updated: base })))).toBe("stale");
    const [c] = await t.db.query<{ email: string }>("SELECT email FROM billing_customers");
    expect(c!.email).toBe("new@payer.example");
  });

  it("links a subscription to its account through the completed payment when the subscription came without one", async () => {
    const t = await server();
    // Delivered first, and without the checkout's custom data.
    expect(await t.result(envelope("subscription.created", subscription({ userId: null })))).toBe("unlinked");
    expect((await t.billing()).plan.id).toBe("free");
    expect(await t.result(envelope("transaction.completed", transaction({ userId: t.user.id })))).toBe("applied");
    expect((await t.billing()).plan.id).toBe("creator");
    expect(await t.rows()).toMatchObject([{ account_id: t.user.id }]);
  });

  it("mirrors a subscription for an unknown account or price without touching anyone's plan", async () => {
    const t = await server();
    expect(await t.result(envelope("subscription.created", subscription({ id: "sub_x", userId: "usr_nobody" })))).toBe("unlinked");
    expect(await t.result(envelope("subscription.created", subscription({ id: "sub_y", userId: t.user.id, priceId: "pri_unknown" })))).toBe("unknown_plan");
    expect((await t.billing()).plan.id).toBe("free");
    expect((await t.rows()).map((r) => r.subscription_id)).toEqual(["sub_x", "sub_y"]);
  });

  it("leaves a plan set by hand alone when no subscription is involved", async () => {
    const t = await server();
    await expectOk(t.owner.put(`/admin/accounts/${t.user.id}/plan`, { plan: "business" }, ORIGIN));
    await t.result(envelope("customer.created", customer({ email: "olu@payer.example" })));
    expect((await t.billing()).plan.id).toBe("business");
  });
});

describe("the customer portal", () => {
  it("mints a session for the signed-in account's own customer and redirects to it", async () => {
    const t = await server();
    await t.result(envelope("subscription.created", subscription({ userId: t.user.id })));
    const res = await t.owner.request("POST", "/billing/portal", {}, ORIGIN);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://customer-portal.paddle.com/cpl_test?c=ctm_1");
    expect(t.minted).toEqual([{ customerId: "ctm_1", ids: ["sub_1"] }]);
  });

  it("uses the session's account, never a customer id the browser sends", async () => {
    const t = await server();
    await t.result(envelope("subscription.created", subscription({ userId: t.user.id })));
    const res = await t.owner.request("POST", "/billing/portal?customer_id=ctm_someone_else", { customerId: "ctm_someone_else" }, ORIGIN);
    expect(res.headers.get("location")).toContain("c=ctm_1");
    expect(t.minted.map((m) => m.customerId)).toEqual(["ctm_1"]);
  });

  it("refuses a stranger, sends someone without a customer back, and keeps members out of the owner's billing", async () => {
    const t = await server();
    expect((await t.client().request("POST", "/billing/portal", {}, ORIGIN)).status).toBe(401);
    expect((await t.client().request("POST", "/billing/portal", {}, { origin: "https://evil.test" })).status).toBe(403);

    const none = await t.owner.request("POST", "/billing/portal", {}, ORIGIN);
    expect([none.status, none.headers.get("location")]).toEqual([303, "/settings?tab=plan&portal=no_customer"]);

    await t.result(envelope("subscription.created", subscription({ userId: t.user.id, priceId: "pri_studio_m" })));
    const { link } = (await expectOk(t.owner.post("/members/invites", { email: "mia@example.com" }, ORIGIN))).body;
    const member = t.client();
    await expectOk(member.post(`/invites/${/\/invite\/([\w-]+)$/.exec(link)![1]}`, { name: "Mia", password: "correct horse battery" }, ORIGIN));
    const refused = await member.request("POST", "/billing/portal", {}, ORIGIN);
    expect(refused.headers.get("location")).toBe("/settings?tab=plan&portal=owner_only");
    expect(t.minted).toEqual([]);
    expect((await member.get("/billing")).body.manageUrl).toBeNull();
  });

  it("goes back to the Plan tab, saying nothing of Paddle's message, when minting fails", async () => {
    const t = await server({ portal: async () => Promise.reject(new Error("ctm_1 owner@example.com not found")) });
    await t.result(envelope("subscription.created", subscription({ userId: t.user.id })));
    const res = await t.owner.request("POST", "/billing/portal", {}, ORIGIN);
    expect([res.status, res.headers.get("location")]).toEqual([303, "/settings?tab=plan&portal=unavailable"]);
  });
});
