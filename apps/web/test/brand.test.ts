// Studio branding: a logo and a colour for the pages guests open. Kept per studio, shown only
// while the account may brand (its plan, on Tapry Cloud), and the logo is only ever an image.
import { describe, expect, it } from "vitest";
import { sniffImage, textOn } from "../src/server/brand";
import { createServer, expectOk } from "./harness";

const PASSWORD = "correct horse battery";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function setup(cloud = false) {
  const t = await createServer(undefined, { allowSignup: true, billing: { cloud } });
  const host = t.client();
  const me = (await expectOk(host.post("/auth/signup", { email: "host@example.com", name: "Host", password: PASSWORD }))).body.user;
  const studio = (await expectOk(host.post("/studios", { name: "My Podcast" }))).body;
  const user = { ...me, accountId: me.accountId ?? me.id };
  return { ...t, host, studio, user };
}

describe("studio branding", () => {
  it("tells image types from their first bytes and picks readable text for a colour", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<html>"))).toBeNull();
    expect(textOn("#000000")).toBe("#ffffff");
    expect(textOn("#1d4ed8")).toBe("#ffffff");
    expect(textOn("#fde047")).toBe("#18181b");
    expect(textOn("#ffffff")).toBe("#18181b");
  });

  it("gives a studio's guests its colour and logo, on every page they open", async () => {
    const t = await setup();
    expect(await t.services.brand.forInvite(t.studio.inviteCode)).toBeNull();
    expect((await expectOk(t.host.get(`/studios/${t.studio.id}/brand`))).body).toEqual({ accent: null, accentText: null, logoUrl: null, allowed: true });

    const set = (await expectOk(t.host.put(`/studios/${t.studio.id}/brand`, { accent: "#1D4ED8" }))).body;
    expect(set).toMatchObject({ accent: "#1d4ed8", accentText: "#ffffff", logoUrl: null });
    expect((await t.host.put(`/studios/${t.studio.id}/brand`, { accent: "blue" })).status).toBe(400);
    expect((await t.host.put(`/studios/${t.studio.id}/brand`, { accent: "#12345" })).status).toBe(400);

    const withLogo = await t.services.brand.setLogo(t.user, t.studio.id, PNG);
    expect(withLogo.logoUrl).toMatch(new RegExp(`^/api/brand/${t.studio.id}/logo\\?v=[0-9a-f]{16}$`));
    const brand = await t.services.brand.forInvite(t.studio.inviteCode);
    expect(brand).toEqual({ accent: "#1d4ed8", accentText: "#ffffff", logoUrl: withLogo.logoUrl });

    // The same in the green room (by session) and nowhere it doesn't belong.
    const ticket = (await expectOk(t.host.post(`/studios/${t.studio.id}/open`))).body;
    expect(await t.services.brand.forSession(ticket.sessionId)).toEqual(brand);
    expect(await t.services.brand.forSession("ses_nope")).toBeNull();
    expect(await t.services.brand.forInvite("nope")).toBeNull();

    // The logo is served as the image it is, cacheable under its versioned address, and as nothing else.
    const res = await t.fetchFor()(new Request(`https://app.test${withLogo.logoUrl}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);

    // Over HTTP, as the settings page sends it: the file is the body.
    const cookie = [...t.host.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const put = (body: Uint8Array, headers: Record<string, string> = { cookie }) =>
      t.fetchFor()(`https://app.test/api/studios/${t.studio.id}/brand/logo`, { method: "PUT", body: body as unknown as BodyInit, headers: { host: "app.test", origin: "https://app.test", ...headers } });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
    const uploaded = await put(jpeg);
    expect(uploaded.status).toBe(200);
    const next = (await uploaded.json()).logoUrl as string;
    expect(next).not.toBe(withLogo.logoUrl);
    expect((await t.fetchFor()(new Request(`https://app.test${next}`))).headers.get("content-type")).toBe("image/jpeg");
    expect((await put(new Uint8Array(600 * 1024).fill(1))).status).toBe(413);
    expect((await put(jpeg, {})).status).toBe(401);

    // Removing each part puts Tapry's back.
    expect((await expectOk(t.host.del(`/studios/${t.studio.id}/brand/logo`))).body.logoUrl).toBeNull();
    expect((await t.fetchFor()(new Request(`https://app.test/api/brand/${t.studio.id}/logo`))).status).toBe(404);
    await expectOk(t.host.put(`/studios/${t.studio.id}/brand`, { accent: null }));
    expect(await t.services.brand.forInvite(t.studio.inviteCode)).toBeNull();
  });

  it("refuses a logo that isn't a small PNG, JPEG or WebP", async () => {
    const t = await setup();
    await expect(t.services.brand.setLogo(t.user, t.studio.id, new TextEncoder().encode("<svg onload='x'/>"))).rejects.toMatchObject({ status: 415, code: "logo_type" });
    await expect(t.services.brand.setLogo(t.user, t.studio.id, new Uint8Array())).rejects.toMatchObject({ status: 400 });
    const big = new Uint8Array(512 * 1024 + 1);
    big.set(PNG);
    await expect(t.services.brand.setLogo(t.user, t.studio.id, big)).rejects.toMatchObject({ status: 413, code: "logo_too_big" });
  });

  it("belongs to the studio's account: nobody else reads or changes it, and it goes with the studio", async () => {
    const t = await setup();
    const other = t.client();
    await expectOk(other.post("/auth/signup", { email: "other@example.com", name: "Other", password: PASSWORD }));
    expect((await other.get(`/studios/${t.studio.id}/brand`)).status).toBe(404);
    expect((await other.put(`/studios/${t.studio.id}/brand`, { accent: "#000000" })).status).toBe(404);
    expect((await t.client().put(`/studios/${t.studio.id}/brand`, { accent: "#000000" })).status).toBe(401);

    await t.services.brand.setLogo(t.user, t.studio.id, PNG);
    await expectOk(t.host.del(`/studios/${t.studio.id}`));
    expect(await t.services.brand.logo(t.studio.id)).toBeNull();
  });

  it("on Tapry Cloud needs a plan with branding, and hides a brand the plan no longer covers", async () => {
    const t = await setup(true);
    expect((await expectOk(t.host.get(`/studios/${t.studio.id}/brand`))).body.allowed).toBe(false);
    const refused = await t.host.put(`/studios/${t.studio.id}/brand`, { accent: "#1d4ed8" });
    expect(refused.status).toBe(402);
    expect(refused.body.error).toBe("plan_no_branding");
    await expect(t.services.brand.setLogo(t.user, t.studio.id, PNG)).rejects.toMatchObject({ status: 402 });

    await t.db.query("UPDATE users SET plan = 'studio' WHERE id = $1", [t.user.id]);
    await expectOk(t.host.put(`/studios/${t.studio.id}/brand`, { accent: "#1d4ed8" }));
    expect(await t.services.brand.forInvite(t.studio.inviteCode)).toMatchObject({ accent: "#1d4ed8" });

    // Back on a smaller plan: kept, not shown, and it can still be cleared.
    await t.db.query("UPDATE users SET plan = 'creator' WHERE id = $1", [t.user.id]);
    expect(await t.services.brand.forInvite(t.studio.inviteCode)).toBeNull();
    expect((await expectOk(t.host.get(`/studios/${t.studio.id}/brand`))).body).toMatchObject({ accent: "#1d4ed8", allowed: false });
    await expectOk(t.host.put(`/studios/${t.studio.id}/brand`, { accent: null }));
  });
});
