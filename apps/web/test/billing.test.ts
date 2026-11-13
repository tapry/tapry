import { createHmac } from "node:crypto";
import { PLANS } from "@tapry/shared";
import { describe, expect, it } from "vitest";
import { billingPeriod, planRetention } from "../src/server/billing";
import { readWebhook, type WebhookConfig } from "../src/server/billing-webhooks";
import { JobRunner } from "../src/server/jobs";
import { createServer, expectOk, FakeStorage, setup } from "./harness";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PADDLE: WebhookConfig = { provider: "paddle", secret: "pdl_test_secret", prices: { pri_creator: "creator", pri_creator_year: "creator", pri_studio: "studio" } };
const LEMON: WebhookConfig = { provider: "lemonsqueezy", secret: "lemon_test_secret", prices: { "501": "creator", "502": "studio" } };
const CHECKOUT = { creator: "https://pay.test/creator?custom[user_id]={user_id}&email={email}", studio: "https://pay.test/studio?u={user_id}" };

const cloud = (extra: object = {}) => setup(new FakeStorage(), { billing: { cloud: true, checkoutUrls: CHECKOUT, manageUrl: "https://pay.test/portal" }, billingWebhook: PADDLE, ...extra });

/** A signed Paddle webhook request body and headers. */
function paddle(event: object, opts: { secret?: string; ts?: number } = {}) {
  const body = JSON.stringify(event);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const h1 = createHmac("sha256", opts.secret ?? PADDLE.secret).update(`${ts}:${body}`).digest("hex");
  return { body, headers: new Headers({ "paddle-signature": `ts=${ts};h1=${h1}` }) };
}

function lemon(event: object, secret = LEMON.secret) {
  const body = JSON.stringify(event);
  return { body, headers: new Headers({ "x-signature": createHmac("sha256", secret).update(body).digest("hex") }) };
}

const subscription = (userId: string, over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
  event_id: `evt_${Math.random().toString(36).slice(2)}`,
  event_type: "subscription.updated",
  occurred_at: new Date().toISOString(),
  ...meta,
  data: {
    id: "sub_1",
    status: "active",
    customer_id: "ctm_1",
    custom_data: { user_id: userId },
    items: [{ price: { id: "pri_creator" } }],
    current_billing_period: { starts_at: new Date(Date.now() - DAY).toISOString(), ends_at: new Date(Date.now() + 29 * DAY).toISOString() },
    scheduled_change: null,
    ...over,
  },
});

describe("billing months", () => {
  const at = (iso: string) => Date.parse(iso);
  const iso = (p: { start: number; end: number }) => [new Date(p.start).toISOString(), new Date(p.end).toISOString()];

  it("is the calendar month without a subscription", () => {
    expect(iso(billingPeriod(null, at("2027-02-14T10:00:00Z")))).toEqual(["2027-02-01T00:00:00.000Z", "2027-03-01T00:00:00.000Z"]);
  });

  it("starts on the subscription's day of the month, at its time", () => {
    const anchor = new Date("2027-01-20T08:30:00Z");
    expect(iso(billingPeriod(anchor, at("2027-01-25T00:00:00Z")))).toEqual(["2027-01-20T08:30:00.000Z", "2027-02-20T08:30:00.000Z"]);
    expect(iso(billingPeriod(anchor, at("2027-03-20T08:29:59Z")))).toEqual(["2027-02-20T08:30:00.000Z", "2027-03-20T08:30:00.000Z"]);
    expect(iso(billingPeriod(anchor, at("2027-03-20T08:30:00Z")))).toEqual(["2027-03-20T08:30:00.000Z", "2027-04-20T08:30:00.000Z"]);
    expect(iso(billingPeriod(anchor, at("2028-01-02T00:00:00Z")))).toEqual(["2027-12-20T08:30:00.000Z", "2028-01-20T08:30:00.000Z"]);
  });

  it("uses a short month's last day for a subscription begun on the 31st", () => {
    const anchor = new Date("2027-01-31T00:00:00Z");
    expect(iso(billingPeriod(anchor, at("2027-02-28T12:00:00Z")))).toEqual(["2027-02-28T00:00:00.000Z", "2027-03-31T00:00:00.000Z"]);
    expect(iso(billingPeriod(anchor, at("2027-02-10T00:00:00Z")))).toEqual(["2027-01-31T00:00:00.000Z", "2027-02-28T00:00:00.000Z"]);
  });
});

describe("a self-hosted server", () => {
  it("has no plans: no billing endpoints, no limit on recording, no deleting by plan", async () => {
    const t = await setup(new FakeStorage(), { billingWebhook: PADDLE });
    expect((await t.hostBrowser.get("/billing")).status).toBe(404);
    expect((await t.hostBrowser.get("/admin/accounts")).status).toBe(404);
    const [{ id }] = (await t.db.query<{ id: string }>("SELECT id FROM users")) as [{ id: string }];
    expect((await t.hostBrowser.put(`/admin/accounts/${id}/plan`, { plan: "team" }, { origin: "https://app.test" })).status).toBe(404);
    const hook = paddle(subscription(id));
    expect((await t.fetchFor()("https://app.test/api/billing/webhook", { method: "POST", body: hook.body, headers: hook.headers })).status).toBe(404);

    // Far past any plan's hours: recording goes on.
    const host = t.client({ token: t.host.token });
    t.tick(500 * HOUR);
    await expectOk(host.post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
    await expectOk(host.post(`/sessions/${t.sessionId}/recordings`));

    // A date left in keep_until means nothing here.
    await t.db.query("UPDATE recordings SET keep_until = now() - interval '1 day' WHERE id = $1", [t.recordingId]);
    await t.db.query("DELETE FROM jobs");
    await new JobRunner(t.db, new FakeStorage(), { ffmpeg: "ffmpeg", ffprobe: "ffprobe" }).drain();
    expect((await t.db.query("SELECT 1 FROM recordings WHERE id = $1 AND deleted_at IS NULL", [t.recordingId])).length).toBe(1);
  });
});

describe("Tapry Cloud plans", () => {
  it("starts everyone on Free and shows what is used, this month only, deleted recordings included", async () => {
    const t = await cloud({ clockStart: 20 * DAY }); // the 21st of a month
    const host = t.client({ token: t.host.token });
    const first = (await expectOk(t.hostBrowser.get("/billing"))).body;
    expect(first.plan).toMatchObject({ id: "free", hours: 2, filesDays: 7 });
    expect(first).toMatchObject({ status: "active", endsAt: null, usedMs: 0, manageUrl: null });
    // Plans that can be bought here, with this account filled into the checkout address.
    const [{ id }] = (await t.db.query<{ id: string }>("SELECT id FROM users")) as [{ id: string }];
    expect(first.upgrades.map((u: any) => [u.plan.id, u.url])).toEqual([
      ["creator", `https://pay.test/creator?custom[user_id]=${id}&email=host%40example.com`],
      ["studio", `https://pay.test/studio?u=${id}`],
    ]);

    // The running recording counts as it goes.
    t.tick(30 * 60_000);
    expect((await t.hostBrowser.get("/billing")).body.usedMs).toBe(30 * 60_000);
    await expectOk(host.post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
    t.tick(HOUR); // not recording: not counted
    expect((await t.hostBrowser.get("/billing")).body.usedMs).toBe(30 * 60_000);

    // Deleting a recording doesn't give its time back.
    await expectOk(t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`, { origin: "https://app.test" }));
    expect((await t.hostBrowser.get("/billing")).body.usedMs).toBe(30 * 60_000);

    // Next month it starts again.
    t.tick(15 * DAY);
    expect((await expectOk(t.hostBrowser.get("/billing"))).body.usedMs).toBe(0);
  });

  it("refuses Record once the month's hours are used, and never stops a recording that is running", async () => {
    const t = await cloud();
    const host = t.client({ token: t.host.token });
    // Three hours in one go on a two-hour plan: it runs on, and uploads still work.
    t.tick(3 * HOUR);
    const state = (await expectOk(host.get(`/sessions/${t.sessionId}/state`))).body;
    expect(state.recording).toMatchObject({ id: t.recordingId, status: "recording" });
    await expectOk(t.call(`/sessions/${t.sessionId}/tracks`, { recordingId: t.recordingId, kind: "audio", mimeType: "audio/webm;codecs=opus", startedAt: t.now() }));
    await expectOk(host.post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));

    const refused = await host.post(`/sessions/${t.sessionId}/recordings`);
    expect(refused.status).toBe(402);
    expect(refused.body.error).toBe("hours_used_up");
    expect(refused.body.message).toContain("2 recording hours on the Free plan");

    // A bigger plan lets them record at once.
    const [{ id }] = (await t.db.query<{ id: string }>("SELECT id FROM users")) as [{ id: string }];
    await expectOk(t.hostBrowser.put(`/admin/accounts/${id}/plan`, { plan: "creator" }, { origin: "https://app.test" }));
    await expectOk(host.post(`/sessions/${t.sessionId}/recordings`));
  });

  it("lets an admin, and only an admin, put an account on a plan, with an end", async () => {
    const t = await cloud({ allowSignup: true });
    const other = t.client();
    await expectOk(other.post("/auth/signup", { email: "other@example.com", name: "Other", password: "correct horse battery" }));
    const accounts = (await expectOk(t.hostBrowser.get("/admin/accounts"))).body.accounts;
    expect(accounts.map((a: any) => [a.email, a.plan])).toEqual([["host@example.com", "free"], ["other@example.com", "free"]]);
    const otherId = accounts[1].id;

    expect((await other.get("/admin/accounts")).status).toBe(404);
    expect((await other.put(`/admin/accounts/${otherId}/plan`, { plan: "team" }, { origin: "https://app.test" })).status).toBe(404);
    expect((await t.hostBrowser.put(`/admin/accounts/${otherId}/plan`, { plan: "gold" }, { origin: "https://app.test" })).status).toBe(400);

    const endsAt = new Date(t.now() + 10 * DAY).toISOString();
    await expectOk(t.hostBrowser.put(`/admin/accounts/${otherId}/plan`, { plan: "team", endsAt }, { origin: "https://app.test" }));
    expect((await other.get("/billing")).body).toMatchObject({ plan: { id: "team", hours: 80 }, endsAt, manageUrl: null });
    // Past its end the account is on Free again, by itself.
    t.tick(11 * DAY);
    expect((await expectOk(other.get("/billing"))).body).toMatchObject({ plan: { id: "free" }, endsAt: null });
  });

  it("shows guests the promo link on Free only", async () => {
    const t = await cloud({ guestPromoUrl: "https://tapry.test/" });
    const guest = t.client({ token: t.guest.token });
    expect((await expectOk(guest.get(`/sessions/${t.sessionId}/my-recordings`))).body.promoUrl).toBe("https://tapry.test/");
    const [{ id }] = (await t.db.query<{ id: string }>("SELECT id FROM users")) as [{ id: string }];
    await expectOk(t.hostBrowser.put(`/admin/accounts/${id}/plan`, { plan: "creator" }, { origin: "https://app.test" }));
    expect((await expectOk(guest.get(`/sessions/${t.sessionId}/my-recordings`))).body.promoUrl).toBeNull();
  });
});

describe("how long a plan keeps a recording", () => {
  const processedNow = (t: Awaited<ReturnType<typeof setup>>) =>
    t.db.query("UPDATE recordings SET status = 'stopped', stopped_at = started_at + 1000, processing = 'ready', processed_at = now() WHERE id = $1", [t.recordingId]);
  const keepDays = async (t: Awaited<ReturnType<typeof setup>>) => {
    const [r] = await t.db.query<{ days: number | null }>("SELECT extract(epoch FROM keep_until - processed_at) / 86400 AS days FROM recordings WHERE id = $1", [t.recordingId]);
    return r!.days === null ? null : Math.round(Number(r!.days));
  };
  const userId = async (t: Awaited<ReturnType<typeof setup>>) => ((await t.db.query<{ id: string }>("SELECT id FROM users")) as [{ id: string }])[0].id;
  const setPlan = async (t: Awaited<ReturnType<typeof setup>>, plan: string) =>
    expectOk(t.hostBrowser.put(`/admin/accounts/${await userId(t)}/plan`, { plan }, { origin: "https://app.test" }));

  it("notes the plan's days when the files are ready, and says how long the originals stay", async () => {
    const t = await cloud();
    await processedNow(t);
    expect(await planRetention(t.db, t.recordingId, t.now())).toBe(7 * DAY);
    expect(await keepDays(t)).toBe(PLANS.free.filesDays);
    // Processing again doesn't buy more time.
    await t.db.query("UPDATE recordings SET processed_at = now() + interval '3 days' WHERE id = $1", [t.recordingId]);
    await planRetention(t.db, t.recordingId, t.now());
    expect(await keepDays(t)).toBe(4);
  });

  it("keeps longer after an upgrade, never shorter after a downgrade, and for good on a plan without a limit", async () => {
    const t = await cloud();
    await processedNow(t);
    await planRetention(t.db, t.recordingId, t.now());
    await setPlan(t, "studio");
    expect(await keepDays(t)).toBe(60);
    await setPlan(t, "creator");
    expect(await keepDays(t)).toBe(60);
    await setPlan(t, "business");
    expect(await keepDays(t)).toBeNull();
    expect(await planRetention(t.db, t.recordingId, t.now())).toBeUndefined();
  });

  it("deletes a recording whose time is over, files and all, and leaves the others", async () => {
    const storage = new FakeStorage();
    const t = await setup(storage, { billing: { cloud: true } });
    const host = t.client({ token: t.host.token });
    await expectOk(host.post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
    t.tick(1000);
    const second = (await expectOk(host.post(`/sessions/${t.sessionId}/recordings`))).body.recording.id as string;
    await expectOk(host.post(`/sessions/${t.sessionId}/recordings/${second}/stop`));
    await t.db.query("DELETE FROM jobs");
    for (const id of [t.recordingId, second]) {
      storage.put(`outputs/${t.sessionId}/${id}/a.wav`, "audio");
      await t.db.query(
        `INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes) VALUES ($1, $2, 'audio', 'Guest - audio.wav', 'audio/wav', $3, 5)`,
        [`out_${id}`, id, `outputs/${t.sessionId}/${id}/a.wav`],
      );
    }
    await t.db.query("UPDATE recordings SET processing = 'ready', processed_at = now() - interval '8 days', keep_until = now() - interval '1 day' WHERE id = $1", [t.recordingId]);
    await t.db.query("UPDATE recordings SET processing = 'ready', processed_at = now(), keep_until = now() + interval '7 days' WHERE id = $1", [second]);

    await new JobRunner(t.db, storage, { ffmpeg: "ffmpeg", ffprobe: "ffprobe", cloud: true }).drain();

    const rows = await t.db.query<{ id: string; gone: boolean }>("SELECT id, deleted_at IS NOT NULL AS gone FROM recordings ORDER BY started_at");
    expect(rows).toEqual([{ id: t.recordingId, gone: true }, { id: second, gone: false }]);
    expect([...storage.objects.keys()]).toEqual([`outputs/${t.sessionId}/${second}/a.wav`]);
    const list = (await expectOk(t.hostBrowser.get(`/studios/${t.studio.id}/recordings`))).body.recordings;
    expect(list.map((r: any) => r.id)).toEqual([second]);
    expect(list[0].keepUntil).toBeGreaterThan(Date.now() + 6 * DAY);
  });

  it("never deletes one that is still recording", async () => {
    const storage = new FakeStorage();
    const t = await setup(storage, { billing: { cloud: true } });
    await t.db.query("UPDATE recordings SET keep_until = now() - interval '1 day' WHERE id = $1", [t.recordingId]);
    await new JobRunner(t.db, storage, { ffmpeg: "ffmpeg", ffprobe: "ffprobe", cloud: true }).drain();
    expect((await t.db.query("SELECT 1 FROM recordings WHERE id = $1 AND deleted_at IS NULL", [t.recordingId])).length).toBe(1);
  });
});

describe("the payment provider's webhook", () => {
  const post = (t: Awaited<ReturnType<typeof setup>>, hook: { body: string; headers: Headers }) =>
    t.fetchFor()("https://app.test/api/billing/webhook", { method: "POST", body: hook.body, headers: hook.headers });
  const userId = async (t: Awaited<ReturnType<typeof setup>>) => ((await t.db.query<{ id: string }>("SELECT id FROM users")) as [{ id: string }])[0].id;
  const billing = async (t: Awaited<ReturnType<typeof setup>>) => (await expectOk(t.hostBrowser.get("/billing"))).body;

  // These use the real clock: the webhook checks the signed time against it.
  const realClock = () => setup(new FakeStorage(), { billing: { cloud: true, checkoutUrls: CHECKOUT, manageUrl: "https://pay.test/portal" }, billingWebhook: PADDLE, clockStart: Date.now() });

  it("refuses a wrong or old signature, and a request without one", async () => {
    const t = await realClock();
    const id = await userId(t);
    expect((await post(t, paddle(subscription(id), { secret: "someone else's" }))).status).toBe(401);
    expect((await post(t, paddle(subscription(id), { ts: Math.floor(Date.now() / 1000) - 3600 }))).status).toBe(401);
    expect((await post(t, { body: JSON.stringify(subscription(id)), headers: new Headers() })).status).toBe(401);
    // A body changed after signing.
    const signed = paddle(subscription(id));
    expect((await post(t, { body: signed.body.replace("pri_creator", "pri_studio"), headers: signed.headers })).status).toBe(401);
    expect((await billing(t)).plan.id).toBe("free");
  });

  it("puts the account on the plan its price stands for, once", async () => {
    const t = await realClock();
    const id = await userId(t);
    const event = subscription(id);
    const res = await post(t, paddle(event));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "applied" });
    const b = await billing(t);
    expect(b).toMatchObject({ plan: { id: "creator" }, status: "active", endsAt: null, manageUrl: "https://pay.test/portal" });
    expect(b.periodStart).toBe(event.data.current_billing_period.starts_at);
    expect(b.upgrades.map((u: any) => u.plan.id)).toEqual(["studio"]);
    // The same event again changes nothing.
    expect(await (await post(t, paddle(event))).json()).toEqual({ result: "duplicate" });
    // An admin can't override a subscription by hand.
    expect((await t.hostBrowser.put(`/admin/accounts/${id}/plan`, { plan: "team" }, { origin: "https://app.test" })).status).toBe(409);
  });

  it("follows a change of plan, a failed payment, a cancellation and the end", async () => {
    const t = await realClock();
    const id = await userId(t);
    const later = (s: number) => ({ occurred_at: new Date(Date.now() + s * 1000).toISOString() });
    await post(t, paddle(subscription(id)));

    await post(t, paddle(subscription(id, { items: [{ price: { id: "pri_studio" } }] }, later(1))));
    expect((await billing(t)).plan.id).toBe("studio");

    await post(t, paddle(subscription(id, { items: [{ price: { id: "pri_studio" } }], status: "past_due" }, later(2))));
    expect(await billing(t)).toMatchObject({ plan: { id: "studio" }, status: "past_due" });

    const ends = new Date(Date.now() + 10 * DAY).toISOString();
    await post(t, paddle(subscription(id, { items: [{ price: { id: "pri_studio" } }], scheduled_change: { action: "cancel", effective_at: ends } }, later(3))));
    expect(await billing(t)).toMatchObject({ plan: { id: "studio" }, status: "canceled", endsAt: ends });

    // An older event arriving late doesn't undo the newer state.
    expect(await (await post(t, paddle(subscription(id, {}, later(-60))))).json()).toEqual({ result: "stale" });
    expect((await billing(t)).status).toBe("canceled");

    await post(t, paddle(subscription(id, { status: "canceled" }, { ...later(4), event_type: "subscription.canceled" })));
    expect(await billing(t)).toMatchObject({ plan: { id: "free" }, status: "active", endsAt: null, manageUrl: null });
  });

  it("ignores other events, unknown prices and unknown accounts without failing", async () => {
    const t = await realClock();
    const id = await userId(t);
    expect(await (await post(t, paddle({ event_id: "evt_x", event_type: "transaction.completed", occurred_at: new Date().toISOString(), data: {} }))).json()).toEqual({ result: "ignored" });
    expect(await (await post(t, paddle(subscription(id, { items: [{ price: { id: "pri_other" } }] })))).json()).toEqual({ result: "unknown_plan" });
    expect(await (await post(t, paddle(subscription("usr_nobody"))))!.json()).toEqual({ result: "unknown_user" });
    expect((await post(t, paddle("not an object" as unknown as object))).status).toBe(200);
    expect((await billing(t)).plan.id).toBe("free");
  });

  it("reads Lemon Squeezy's format too", () => {
    const now = Date.now();
    const event = (status: string, extra: object = {}) => ({
      meta: { event_name: "subscription_updated", custom_data: { user_id: "usr_abc" } },
      data: { id: "77", attributes: { status, variant_id: 502, customer_id: 9, created_at: "2027-01-20T08:30:00.000000Z", updated_at: "2027-02-01T10:00:00.000000Z", ends_at: null, ...extra } },
    });
    const hook = lemon(event("active"));
    expect(readWebhook(LEMON, hook.body, hook.headers, now)).toMatchObject({
      id: "lemonsqueezy:77:subscription_updated:2027-02-01T10:00:00.000Z",
      userId: "usr_abc",
      plan: "studio",
      status: "active",
      customer: "9",
      subscription: "77",
      periodStart: new Date("2027-01-20T08:30:00Z"),
    });
    const cancelled = lemon(event("cancelled", { ends_at: "2027-02-20T08:30:00.000000Z" }));
    expect(readWebhook(LEMON, cancelled.body, cancelled.headers, now)).toMatchObject({ status: "canceled", endsAt: new Date("2027-02-20T08:30:00Z") });
    const expired = lemon(event("expired"));
    expect(readWebhook(LEMON, expired.body, expired.headers, now)).toMatchObject({ status: "ended" });
    const payment = lemon({ meta: { event_name: "subscription_payment_success" }, data: { id: "1", attributes: {} } });
    expect(readWebhook(LEMON, payment.body, payment.headers, now)).toBeNull();
    expect(() => readWebhook(LEMON, hook.body, lemon(event("active"), "wrong").headers, now)).toThrow(/signature/);
    expect(() => readWebhook(LEMON, hook.body, new Headers(), now)).toThrow(/signature/);
  });
});

describe("configuration", () => {
  it("reads prices and checkout addresses, and is off by default", async () => {
    const { loadConfig } = await import("../src/server/config");
    const base = { S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" };
    expect(loadConfig(base).cloud).toBeNull();
    expect(loadConfig(base).worker.cloud).toBe(false);
    const cfg = loadConfig({
      ...base,
      TAPRY_CLOUD: "true",
      BILLING_PROVIDER: "lemonsqueezy",
      BILLING_WEBHOOK_SECRET: "a-long-secret",
      BILLING_PRICES: "501=creator, 502=studio",
      BILLING_CHECKOUT_URLS: "creator=https://pay.test/c?custom[user_id]={user_id}&a=b",
      BILLING_MANAGE_URL: "https://pay.test/portal",
    });
    expect(cfg.cloud).toEqual({
      checkoutUrls: { creator: "https://pay.test/c?custom[user_id]={user_id}&a=b" },
      manageUrl: "https://pay.test/portal",
      webhook: { provider: "lemonsqueezy", secret: "a-long-secret", prices: { "501": "creator", "502": "studio" } },
      paddle: null,
    });
    expect(cfg.worker.cloud).toBe(true);
    expect(loadConfig({ ...base, TAPRY_CLOUD: "true" }).cloud).toEqual({ checkoutUrls: {}, manageUrl: null, webhook: null, paddle: null });
    expect(() => loadConfig({ ...base, TAPRY_CLOUD: "true", BILLING_PRICES: "501=gold" })).toThrow(/not a plan/);
  });

  it("answers 404 on the webhook when cloud is on but no provider is set up", async () => {
    const server = await createServer(new FakeStorage(), { billing: { cloud: true } });
    const hook = paddle(subscription("usr_x"));
    expect((await server.fetchFor()("https://app.test/api/billing/webhook", { method: "POST", body: hook.body, headers: hook.headers })).status).toBe(404);
  });
});
