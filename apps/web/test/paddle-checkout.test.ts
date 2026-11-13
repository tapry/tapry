import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config";
import { createServer, expectOk, FakeStorage } from "./harness";

const PASSWORD = "correct horse battery";
const ORIGIN = { origin: "https://app.test" };
const PADDLE = { clientToken: "test_0123456789abcdef", sandbox: true, prices: { creator: { monthly: "pri_cm", yearly: "pri_cy" }, studio: { monthly: "pri_sm" }, team: { yearly: "pri_ty" } } };

async function server(billing: object = { cloud: true, paddle: PADDLE }) {
  const t = await createServer(new FakeStorage(), { billing: billing as never });
  const owner = t.client();
  const user = (await expectOk(owner.post("/auth/signup", { email: "owner@example.com", name: "Olu Owner", password: PASSWORD }))).body.user;
  return { ...t, owner, user };
}

describe("Paddle's checkout on our own page", () => {
  it("reads monthly and yearly prices from the configuration; the webhook still maps both to the plan", () => {
    const base = { S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", TAPRY_CLOUD: "true" };
    const cfg = loadConfig({
      ...base,
      BILLING_WEBHOOK_SECRET: "a-long-secret",
      BILLING_PRICES: "pri_cm=creator, pri_cy=creator:yearly, pri_sm=studio",
      BILLING_PADDLE_CLIENT_TOKEN: "test_0123456789abcdef",
      BILLING_PADDLE_ENVIRONMENT: "sandbox",
    });
    expect(cfg.cloud!.paddle).toEqual({
      clientToken: "test_0123456789abcdef",
      sandbox: true,
      prices: { creator: { monthly: "pri_cm", yearly: "pri_cy" }, studio: { monthly: "pri_sm" } },
    });
    expect(cfg.cloud!.webhook!.prices).toEqual({ pri_cm: "creator", pri_cy: "creator", pri_sm: "studio" });
    // No token, or another provider: no checkout page.
    expect(loadConfig({ ...base, BILLING_PRICES: "pri_cm=creator" }).cloud!.paddle).toBeNull();
    expect(loadConfig({ ...base, BILLING_PROVIDER: "lemonsqueezy", BILLING_PADDLE_CLIENT_TOKEN: "test_0123456789abcdef", BILLING_PADDLE_ENVIRONMENT: "sandbox" }).cloud!.paddle).toBeNull();
    expect(() => loadConfig({ ...base, BILLING_PRICES: "pri_cm=gold:yearly" })).toThrow(/not a plan/);
    // The environment is never guessed: required with a token, and it must match the token.
    expect(() => loadConfig({ ...base, BILLING_PADDLE_CLIENT_TOKEN: "live_0123456789abcdef" })).toThrow(/BILLING_PADDLE_ENVIRONMENT must be set/);
    expect(() => loadConfig({ ...base, BILLING_PADDLE_API_KEY: "pdl_live_apikey_x" })).toThrow(/BILLING_PADDLE_ENVIRONMENT must be set/);
    expect(() => loadConfig({ ...base, BILLING_PADDLE_CLIENT_TOKEN: "live_0123456789abcdef", BILLING_PADDLE_ENVIRONMENT: "sandbox" })).toThrow(/doesn't match/);
    expect(() => loadConfig({ ...base, BILLING_PADDLE_CLIENT_TOKEN: "test_0123456789abcdef", BILLING_PADDLE_ENVIRONMENT: "production" })).toThrow(/doesn't match/);
    expect(loadConfig({ ...base, BILLING_PADDLE_CLIENT_TOKEN: "live_0123456789abcdef", BILLING_PADDLE_ENVIRONMENT: "production" }).cloud!.paddle!.sandbox).toBe(false);
  });

  it("offers each plan that has a price, by the month and by the year where both exist", async () => {
    const t = await server();
    const { upgrades } = (await expectOk(t.owner.get("/billing"))).body;
    expect(upgrades.map((u: any) => [u.plan.id, u.url, u.yearlyUrl])).toEqual([
      ["creator", "/checkout/creator", "/checkout/creator?yearly=1"],
      ["studio", "/checkout/studio", undefined],
      ["team", "/checkout/team?yearly=1", undefined], // sold by the year only
    ]);
  });

  it("gives the checkout page the price and the account to attach, for the owner only", async () => {
    const t = await server();
    const user = (await t.services.auth.userForToken(t.owner.jar.get("ot_session")))!;
    expect(t.services.billing.checkout(user, "creator", false)).toMatchObject({ plan: { id: "creator" }, yearly: false, priceId: "pri_cm", clientToken: PADDLE.clientToken, sandbox: true, accountId: t.user.id, email: "owner@example.com" });
    expect(t.services.billing.checkout(user, "creator", true)).toMatchObject({ yearly: true, priceId: "pri_cy" });
    // Not sold that way, not a plan, or free.
    for (const [plan, yearly] of [["studio", true], ["team", false], ["business", false], ["free", false], ["gold", false]] as const) {
      expect(() => t.services.billing.checkout(user, plan, yearly)).toThrow(/Not found/);
    }

    // A member's payment would attach to the owner's account, so only the owner may open it.
    await expectOk(t.owner.put(`/admin/accounts/${t.user.id}/plan`, { plan: "studio" }, ORIGIN));
    const { link } = (await expectOk(t.owner.post("/members/invites", { email: "mia@example.com" }, ORIGIN))).body;
    const member = t.client();
    await expectOk(member.post(`/invites/${/\/invite\/([\w-]+)$/.exec(link)![1]}`, { name: "Mia", password: PASSWORD }, ORIGIN));
    const mia = (await t.services.auth.userForToken(member.jar.get("ot_session")))!;
    expect(() => t.services.billing.checkout(mia, "team", true)).toThrow(/owner/);
  });

  it("isn't there without Paddle set up, or on a self-hosted server", async () => {
    const plain = await server({ cloud: true });
    const user = (await plain.services.auth.userForToken(plain.owner.jar.get("ot_session")))!;
    expect(() => plain.services.billing.checkout(user, "creator", false)).toThrow(/Not found/);
    expect((await plain.owner.get("/billing")).body.upgrades).toEqual([]);

    const selfHosted = await server({ cloud: false, paddle: PADDLE });
    const host = (await selfHosted.services.auth.userForToken(selfHosted.owner.jar.get("ot_session")))!;
    expect(() => selfHosted.services.billing.checkout(host, "creator", false)).toThrow(/Not found/);
  });
});
