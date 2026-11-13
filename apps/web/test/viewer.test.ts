// A viewer: a member who may look, listen, download and comment, and change nothing.
import { beforeEach, describe, expect, it } from "vitest";
import { createServer, expectOk } from "./harness";

const PASSWORD = "correct horse battery";
const ORIGIN = { origin: "https://app.test" };

describe("viewer role", () => {
  let t: Awaited<ReturnType<typeof createServer>>;
  let owner: ReturnType<typeof t.client>;
  let studioId: string;
  beforeEach(async () => {
    t = await createServer();
    owner = t.client();
    await expectOk(owner.post("/auth/signup", { email: "owner@example.com", name: "Olu Owner", password: PASSWORD }));
    studioId = (await expectOk(owner.post("/studios", { name: "Interviews" }, ORIGIN))).body.id;
  });
  async function join(email: string, role?: string) {
    const { link } = (await expectOk(owner.post("/members/invites", { email, ...(role ? { role } : {}) }, ORIGIN))).body;
    const member = t.client();
    await expectOk(member.post(`/invites/${/\/invite\/([\w-]+)$/.exec(link)![1]}`, { name: email.split("@")[0], password: PASSWORD }, ORIGIN));
    return member;
  }

  it("is given with the invitation and shown to the account", async () => {
    await join("vera@example.com", "viewer");
    await join("mia@example.com");
    const roles = (await owner.get("/members")).body.members.map((m: { email: string; role: string }) => [m.email, m.role]);
    expect(roles).toEqual([["owner@example.com", "owner"], ["vera@example.com", "viewer"], ["mia@example.com", "member"]]);
  });

  it("can see everything in the account and change nothing", async () => {
    const vera = await join("vera@example.com", "viewer");
    expect((await vera.get("/studios")).body.studios.map((s: { id: string }) => s.id)).toEqual([studioId]);
    expect((await vera.get(`/studios/${studioId}/recordings`)).status).toBe(200);
    for (const res of [
      await vera.post("/studios", { name: "Mine" }, ORIGIN),
      await vera.patch(`/studios/${studioId}`, { name: "Renamed" }, ORIGIN),
      await vera.del(`/studios/${studioId}`, ORIGIN),
      await vera.post(`/studios/${studioId}/open`, {}, ORIGIN),
      await vera.put(`/studios/${studioId}/guide`, { guide: "x" }, ORIGIN),
      await vera.put(`/studios/${studioId}/solo`, { enabled: true, prompt: "" }, ORIGIN),
    ]) {
      expect([res.status, res.body.error]).toEqual([403, "viewer"]);
    }
    expect((await owner.get(`/studios/${studioId}`)).body.name).toBe("Interviews");
  });

  it("is the owner's to change, takes effect at once, and a viewer can still leave", async () => {
    const vera = await join("vera@example.com", "viewer");
    const id = (await owner.get("/members")).body.members.find((m: { email: string }) => m.email === "vera@example.com").id;
    expect((await vera.put(`/members/${id}`, { role: "member" }, ORIGIN)).status).toBe(403);
    await expectOk(owner.put(`/members/${id}`, { role: "member" }, ORIGIN));
    expect((await vera.patch(`/studios/${studioId}`, { name: "Renamed" }, ORIGIN)).status).toBe(200);
    await expectOk(owner.put(`/members/${id}`, { role: "viewer" }, ORIGIN));
    expect((await vera.patch(`/studios/${studioId}`, { name: "Again" }, ORIGIN)).status).toBe(403);
    expect((await vera.del(`/members/${id}`, ORIGIN)).status).toBe(204);
    // Out of the account, they are an ordinary person again, not a viewer of their own empty account.
    await expectOk(owner.post("/members/invites", { email: "vera@example.com" }, ORIGIN));
    expect(await t.db.query("SELECT member_role FROM users WHERE email = 'vera@example.com'")).toEqual([{ member_role: "member" }]);
  });
});
