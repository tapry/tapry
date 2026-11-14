// Profile pictures of hosts and members: each person sets their own, it is only ever an image,
// and it shows to the others in the account and to guests on the invite.
import { describe, expect, it } from "vitest";
import { createServer, expectOk } from "./harness";

const PASSWORD = "correct horse battery";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function setup() {
  const t = await createServer(undefined, { allowSignup: true });
  const host = t.client();
  await expectOk(host.post("/auth/signup", { email: "host@example.com", name: "Host", password: PASSWORD }));
  const studio = (await expectOk(host.post("/studios", { name: "My Podcast" }))).body;
  const cookie = () => [...host.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const put = (body: Uint8Array, headers: Record<string, string> = { cookie: cookie() }) =>
    t.fetchFor()("https://app.test/api/auth/avatar", { method: "PUT", body: body as unknown as BodyInit, headers: { host: "app.test", origin: "https://app.test", ...headers } });
  return { ...t, host, studio, put };
}

describe("profile pictures", () => {
  it("lets a person set, see, replace and remove their own picture", async () => {
    const t = await setup();
    expect((await expectOk(t.host.get("/auth/me"))).body.user.avatarUrl).toBeNull();
    const res = await t.put(JPEG);
    expect(res.status).toBe(200);
    const { avatarUrl } = (await res.json()) as { avatarUrl: string };
    const me = (await expectOk(t.host.get("/auth/me"))).body.user;
    expect(avatarUrl).toBe(`/api/avatars/${me.id}?v=${avatarUrl.split("v=")[1]}`);
    expect(me.avatarUrl).toBe(avatarUrl);

    const img = await t.fetchFor()(new Request(`https://app.test${avatarUrl}`));
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(JPEG);

    // The members list and the invite page carry it.
    expect((await expectOk(t.host.get("/members"))).body.members[0].avatarUrl).toBe(avatarUrl);
    expect((await t.services.studios.invitePreview(t.studio.inviteCode))!.hostAvatarUrl).toBe(avatarUrl);

    // A new picture has a new address, so nothing cached shows the old one.
    const next = (await (await t.put(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]))).json()) as { avatarUrl: string };
    expect(next.avatarUrl).not.toBe(avatarUrl);

    expect((await t.host.del("/auth/avatar")).status).toBe(204);
    expect((await expectOk(t.host.get("/auth/me"))).body.user.avatarUrl).toBeNull();
    expect((await t.fetchFor()(new Request(`https://app.test/api/avatars/${me.id}`))).status).toBe(404);
    expect((await t.services.studios.invitePreview(t.studio.inviteCode))!.hostAvatarUrl).toBeNull();
  });

  it("refuses anything that isn't a small PNG, JPEG or WebP, and anyone not signed in", async () => {
    const t = await setup();
    expect((await t.put(new TextEncoder().encode("<svg onload='x'/>"))).status).toBe(415);
    expect((await t.put(new Uint8Array())).status).toBe(400);
    expect((await t.put(new Uint8Array(300 * 1024).fill(1))).status).toBe(413);
    expect((await t.put(JPEG, {})).status).toBe(401);
    // From another site's page: refused before anything is read.
    expect((await t.put(JPEG, { cookie: [...t.host.jar].map(([k, v]) => `${k}=${v}`).join("; "), origin: "https://evil.example" })).status).toBe(403);
  });
});
