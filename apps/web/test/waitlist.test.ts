import { describe, expect, it } from "vitest";
import { WAITLIST_PER_ADDRESS } from "../src/server/waitlist";
import { createServer, expectOk } from "./harness";

const PASSWORD = "correct horse battery";
const SITE = "https://tapry.test";
const APP = { origin: "https://app.test" };

async function server(cloud = true) {
  const t = await createServer(undefined, { allowSignup: true, siteOrigins: [SITE], billing: { cloud } });
  const join = (body: unknown, headers: Record<string, string> = {}) =>
    t.fetchFor()("https://app.test/api/waitlist", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: SITE, "x-forwarded-for": "203.0.113.7", ...headers } });
  const admin = t.client();
  await expectOk(admin.post("/auth/signup", { email: "admin@example.com", name: "Ada Admin", password: PASSWORD }));
  return { ...t, join, admin };
}

describe("the website's waitlist for paid plans", () => {
  it("takes an address once, with the plan asked about, and answers the same when it's already there", async () => {
    const t = await server();
    const first = await t.join({ email: "Rana@Example.com", plan: "studio" });
    expect(first.status).toBe(200);
    expect(first.headers.get("access-control-allow-origin")).toBe(SITE);
    t.tick(60_000);
    const again = await t.join({ email: "rana@example.com" });
    expect([again.status, await again.json()]).toEqual([200, { ok: true }]);
    await t.join({ email: "sam@example.com" });

    const { entries } = (await expectOk(t.admin.get("/admin/waitlist"))).body;
    // Newest first; the second ask kept the first date and the plan.
    expect(entries.map((e: any) => [e.email, e.plan])).toEqual([["sam@example.com", null], ["rana@example.com", "studio"]]);
    expect(entries[1].createdAt).toBe(new Date(1_000_000).toISOString());
  });

  it("refuses what isn't an address or a plan, and limits each address per hour", async () => {
    const t = await server();
    expect((await t.join({ email: "not an address" })).status).toBe(400);
    expect((await t.join({ email: "a@example.com", plan: "gold" })).status).toBe(400);
    for (let i = 0; i < WAITLIST_PER_ADDRESS; i++) expect((await t.join({ email: `p${i}@example.com` })).status).toBe(200);
    const limited = await t.join({ email: "late@example.com" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("access-control-allow-origin")).toBe(SITE); // the website can show why
    expect((await t.join({ email: "late@example.com" }, { "x-forwarded-for": "198.51.100.2" })).status).toBe(200);
    t.tick(61 * 60_000);
    expect((await t.join({ email: "later@example.com" })).status).toBe(200);
  });

  it("is readable from the website only, and the list is the admin's", async () => {
    const t = await server();
    const other = await t.join({ email: "x@example.com" }, { origin: "https://elsewhere.test" });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await t.fetchFor()("https://app.test/api/waitlist", { method: "OPTIONS", headers: { origin: SITE, "access-control-request-method": "POST" } });
    expect([preflight.status, preflight.headers.get("access-control-allow-headers")]).toEqual([204, "content-type"]);

    const someone = t.client();
    await expectOk(someone.post("/auth/signup", { email: "host@example.com", name: "Hana Host", password: PASSWORD }));
    expect((await someone.get("/admin/waitlist")).status).toBe(404);
    expect((await t.client().get("/admin/waitlist")).status).toBe(401);
    expect((await someone.request("DELETE", "/admin/waitlist", { email: "x@example.com" }, APP)).status).toBe(404);

    await expectOk(t.admin.request("DELETE", "/admin/waitlist", { email: "x@example.com" }, APP));
    expect((await t.admin.get("/admin/waitlist")).body.entries).toEqual([]);
  });

  it("isn't there on a self-hosted server", async () => {
    const t = await server(false);
    expect((await t.join({ email: "a@example.com" })).status).toBe(404);
    expect((await t.admin.get("/admin/waitlist")).status).toBe(404);
  });
});

describe("whether this browser is signed in, for the website's menu", () => {
  it("says only yes or no, readable with the cookie from the website's origin alone", async () => {
    const t = await server();
    const ask = (cookie: string | null, origin = SITE) =>
      t.fetchFor()("https://app.test/api/auth/status", { headers: { origin, ...(cookie ? { cookie } : {}) } });
    const out = await ask(null);
    expect(await out.json()).toEqual({ signedIn: false });
    expect([out.headers.get("access-control-allow-origin"), out.headers.get("access-control-allow-credentials"), out.headers.get("cache-control")]).toEqual([SITE, "true", "no-store"]);

    const cookie = `ot_session=${t.admin.jar.get("ot_session")}`;
    expect(await (await ask(cookie)).json()).toEqual({ signedIn: true });
    const elsewhere = await ask(cookie, "https://elsewhere.test");
    expect(elsewhere.headers.get("access-control-allow-origin")).toBeNull();
    expect(elsewhere.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
