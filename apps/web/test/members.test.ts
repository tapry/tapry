import { describe, expect, it } from "vitest";
import type { MailMessage, Mailer } from "../src/server/mail";
import { createServer, expectOk, FakeStorage } from "./harness";

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  fail: Error | null = null;
  async send(message: MailMessage) {
    if (this.fail) throw this.fail;
    this.sent.push(message);
  }
  async verify() {}
}

const PASSWORD = "correct horse battery";
const ORIGIN = { origin: "https://app.test" };
const DAY = 86_400_000;

/** A server with one account (the owner, with a studio). `cloud` adds plans; `mail` a mailer. */
async function server(opts: { cloud?: boolean; mail?: boolean; allowSignup?: boolean } = {}) {
  const mailer = new FakeMailer();
  const t = await createServer(new FakeStorage(), {
    allowSignup: opts.allowSignup ?? false,
    billing: { cloud: !!opts.cloud },
    ...(opts.mail ? { mailer, appUrl: "https://studio.test/" } : {}),
  });
  const owner = t.client();
  const ownerUser = (await expectOk(owner.post("/auth/signup", { email: "owner@example.com", name: "Olu Owner", password: PASSWORD }))).body.user;
  const studio = (await expectOk(owner.post("/studios", { name: "The Show" }))).body;
  const tokenOf = (link: string) => /\/invite\/([\w-]+)$/.exec(link)![1]!;
  /** Invite an address and have a new person accept it; returns their signed-in client. */
  const join = async (email: string, name = "Mia Member") => {
    const { link } = (await expectOk(owner.post("/members/invites", { email }, ORIGIN))).body;
    const member = t.client();
    await expectOk(member.post(`/invites/${tokenOf(link)}`, { name, password: PASSWORD }, ORIGIN));
    return member;
  };
  const setPlan = (plan: string) => expectOk(owner.put(`/admin/accounts/${ownerUser.id}/plan`, { plan }, ORIGIN));
  return { ...t, mailer, owner, ownerUser, studio, tokenOf, join, setPlan };
}

describe("inviting someone into an account", () => {
  it("gives the owner a link; the invited person makes their own log-in, even where sign-up is closed", async () => {
    const t = await server();
    expect((await t.client().post("/auth/signup", { email: "stranger@example.com", name: "S", password: PASSWORD })).status).toBe(403); // closed

    const res = (await expectOk(t.owner.post("/members/invites", { email: " Mia@Example.com " }, ORIGIN))).body;
    expect(res.emailed).toBe(false);
    expect(res.link).toMatch(/^https:\/\/app\.test\/invite\/[\w-]{20,}$/);
    const token = t.tokenOf(res.link);
    // Only the token's hash is kept.
    expect(JSON.stringify(await t.db.query("SELECT * FROM account_invites"))).not.toContain(token);

    expect((await expectOk(t.client().get(`/invites/${token}`))).body).toEqual({ inviter: "Olu Owner", email: "mia@example.com", hasAccount: false });
    expect((await t.client().get("/invites/not-a-real-token-at-all-000")).status).toBe(404);

    const member = t.client();
    expect((await member.post(`/invites/${token}`, { name: "Mia Member", password: "short" }, ORIGIN)).status).toBe(400);
    expect((await member.post(`/invites/${token}`, {}, ORIGIN)).status).toBe(400); // nobody signed in, nothing sent
    await expectOk(member.post(`/invites/${token}`, { name: "Mia Member", password: PASSWORD }, ORIGIN));
    const me = (await expectOk(member.get("/auth/me"))).body.user;
    expect(me).toMatchObject({ email: "mia@example.com", name: "Mia Member", isAdmin: false, emailVerified: true, accountId: t.ownerUser.id });
    // Used once.
    expect((await t.client().post(`/invites/${token}`, { name: "Again", password: PASSWORD }, ORIGIN)).status).toBe(404);
    // And they can log in again later.
    await expectOk(t.client().post("/auth/login", { email: "mia@example.com", password: PASSWORD }));

    const view = (await expectOk(t.owner.get("/members"))).body;
    expect(view.members.map((m: any) => [m.name, m.role, m.you])).toEqual([["Olu Owner", "owner", true], ["Mia Member", "member", false]]);
    expect(view).toMatchObject({ seats: null, owner: true, invites: [] });
  });

  it("emails the invitation where the server sends email, and still returns the link when that fails", async () => {
    const t = await server({ mail: true });
    const res = (await expectOk(t.owner.post("/members/invites", { email: "mia@example.com" }, ORIGIN))).body;
    expect(res.emailed).toBe(true);
    expect(res.link.startsWith("https://studio.test/invite/")).toBe(true);
    const mail = t.mailer.sent[0]!;
    expect([mail.to, mail.subject]).toEqual(["mia@example.com", "Olu Owner invited you to Tapry"]);
    expect(mail.text).toContain(res.link);

    t.mailer.fail = Object.assign(new Error("550 ben@example.com rejected"), { code: "EENVELOPE", responseCode: 550 });
    const second = (await expectOk(t.owner.post("/members/invites", { email: "ben@example.com" }, ORIGIN))).body;
    expect(second.emailed).toBe(false);
    expect(second.link).toContain("/invite/");
  });

  it("replaces an older invitation to the same address, can be withdrawn, and runs out after a week", async () => {
    const t = await server();
    const first = t.tokenOf((await expectOk(t.owner.post("/members/invites", { email: "mia@example.com" }, ORIGIN))).body.link);
    const second = t.tokenOf((await expectOk(t.owner.post("/members/invites", { email: "mia@example.com" }, ORIGIN))).body.link);
    expect((await t.client().get(`/invites/${first}`)).status).toBe(404);
    const view = (await t.owner.get("/members")).body;
    expect(view.invites.map((i: any) => i.email)).toEqual(["mia@example.com"]);

    expect((await t.owner.del(`/members/invites/${view.invites[0].id}`, ORIGIN)).status).toBe(204);
    expect((await t.client().get(`/invites/${second}`)).status).toBe(404);

    const third = t.tokenOf((await expectOk(t.owner.post("/members/invites", { email: "mia@example.com" }, ORIGIN))).body.link);
    t.tick(7 * DAY + 60_000);
    expect((await t.client().post(`/invites/${third}`, { name: "Mia", password: PASSWORD }, ORIGIN)).status).toBe(404);
    expect((await t.owner.get("/auth/me")).status).toBe(200); // the owner's own session is still good
  });

  it("refuses to invite someone already in the account, and anyone but the owner inviting", async () => {
    const t = await server();
    const member = await t.join("mia@example.com");
    for (const email of ["mia@example.com", "owner@example.com"]) {
      const res = await t.owner.post("/members/invites", { email }, ORIGIN);
      expect([res.status, res.body.error]).toEqual([409, "already_member"]);
    }
    const res = await member.post("/members/invites", { email: "ben@example.com" }, ORIGIN);
    expect([res.status, res.body.error]).toEqual([403, "owner_only"]);
    expect((await t.client().get("/members")).status).toBe(401);
    // A member sees who is in the account, not who else was invited.
    await expectOk(t.owner.post("/members/invites", { email: "ben@example.com" }, ORIGIN));
    expect((await member.get("/members")).body).toMatchObject({ owner: false, invites: [] });
  });
});

describe("working in someone's account", () => {
  it("shows a member the account's studios and recordings, and lets them create, host and delete", async () => {
    const t = await server();
    const member = await t.join("mia@example.com");
    expect((await expectOk(member.get("/studios"))).body.studios.map((s: any) => s.name)).toEqual(["The Show"]);

    // The member hosts a session in the owner's studio, under their own name.
    const ticket = (await expectOk(member.post(`/studios/${t.studio.id}/open`))).body;
    const asMember = t.client({ token: ticket.token });
    const state = (await expectOk(asMember.post(`/sessions/${ticket.sessionId}/recordings`))).body;
    expect(state.participants.map((p: any) => [p.displayName, p.role])).toEqual([["Mia Member", "host"]]);
    // The owner opens the same session and is a host too.
    const ownerTicket = (await expectOk(t.owner.post(`/studios/${t.studio.id}/open`))).body;
    expect(ownerTicket.sessionId).toBe(ticket.sessionId);
    await expectOk(asMember.post(`/sessions/${ticket.sessionId}/recordings/${state.recording.id}/stop`));

    // Both see the recording; a studio the member creates belongs to the account.
    expect((await expectOk(t.owner.get("/recordings"))).body.recordings.map((r: any) => r.id)).toEqual([state.recording.id]);
    expect((await expectOk(member.get("/recordings"))).body.recordings.map((r: any) => r.id)).toEqual([state.recording.id]);
    const made = (await expectOk(member.post("/studios", { name: "Mia's" }))).body;
    expect((await t.owner.get("/studios")).body.studios.map((s: any) => s.name).sort()).toEqual(["Mia's", "The Show"]);
    const [{ owner_id }] = (await t.db.query<{ owner_id: string }>("SELECT owner_id FROM studios WHERE id = $1", [made.id])) as [{ owner_id: string }];
    expect(owner_id).toBe(t.ownerUser.id);
    await t.db.query("DELETE FROM jobs");
    expect((await member.del(`/studios/${t.studio.id}/recordings/${state.recording.id}`, ORIGIN)).status).toBe(204);
  });

  it("keeps other accounts apart", async () => {
    const t = await server({ allowSignup: true });
    const other = t.client();
    await expectOk(other.post("/auth/signup", { email: "other@example.com", name: "Other", password: PASSWORD }));
    const member = await t.join("mia@example.com");
    expect((await other.get("/studios")).body.studios).toEqual([]);
    expect((await other.get(`/studios/${t.studio.id}`)).status).toBe(404);
    expect((await other.get("/members")).body.members.map((m: any) => m.email)).toEqual(["other@example.com"]);
    // Nobody removes people from an account that isn't theirs.
    const mia = (await member.get("/auth/me")).body.user;
    expect((await other.del(`/members/${mia.id}`, ORIGIN)).status).toBe(404);
    expect((await member.get("/auth/me")).body.user.accountId).toBe(t.ownerUser.id);
  });

  it("lets the owner remove a member, and a member leave: they are signed out and see nothing of the account", async () => {
    const t = await server();
    const mia = await t.join("mia@example.com");
    const ben = await t.join("ben@example.com", "Ben Member");
    const miaId = (await mia.get("/auth/me")).body.user.id;
    const benId = (await ben.get("/auth/me")).body.user.id;

    expect((await mia.del(`/members/${benId}`, ORIGIN)).status).toBe(403); // a member can't remove another
    expect((await mia.del(`/members/${t.ownerUser.id}`, ORIGIN)).status).toBe(409); // nor the owner
    expect((await t.owner.del(`/members/${t.ownerUser.id}`, ORIGIN)).status).toBe(409);

    expect((await t.owner.del(`/members/${benId}`, ORIGIN)).status).toBe(204);
    expect((await ben.get("/auth/me")).status).toBe(401);
    const benAgain = t.client();
    const benUser = (await expectOk(benAgain.post("/auth/login", { email: "ben@example.com", password: PASSWORD }))).body.user;
    expect(benUser.accountId).toBe(benId);
    expect((await benAgain.get("/studios")).body.studios).toEqual([]);

    expect((await mia.del(`/members/${miaId}`, ORIGIN)).status).toBe(204); // leaving
    expect((await mia.get("/auth/me")).status).toBe(401);
    expect((await t.owner.get("/members")).body.members.map((m: any) => m.email)).toEqual(["owner@example.com"]);
  });

  it("lets someone who already has an empty account of their own join by logging in, but not leave studios behind", async () => {
    const t = await server({ allowSignup: true });
    const existing = t.client();
    const user = (await expectOk(existing.post("/auth/signup", { email: "sam@example.com", name: "Sam", password: PASSWORD }))).body.user;
    const token = t.tokenOf((await expectOk(t.owner.post("/members/invites", { email: "sam@example.com" }, ORIGIN))).body.link);
    expect((await t.client().get(`/invites/${token}`)).body.hasAccount).toBe(true);
    // Not by making a second account for the address.
    const res = await t.client().post(`/invites/${token}`, { name: "Sam", password: PASSWORD }, ORIGIN);
    expect([res.status, res.body.error]).toEqual([409, "email_taken"]);

    const studio = (await expectOk(existing.post("/studios", { name: "Sam's own" }))).body;
    const blocked = await existing.post(`/invites/${token}`, {}, ORIGIN);
    expect([blocked.status, blocked.body.error]).toEqual([409, "has_own_account"]);
    await expectOk(existing.del(`/studios/${studio.id}`, ORIGIN));
    await expectOk(existing.post(`/invites/${token}`, {}, ORIGIN));
    expect((await existing.get("/auth/me")).body.user).toMatchObject({ id: user.id, accountId: t.ownerUser.id });
    expect((await existing.get("/studios")).body.studios.map((s: any) => s.name)).toEqual(["The Show"]);

    // Someone signed in with another address can't take an invitation meant for someone else.
    const other = t.client();
    await expectOk(other.post("/auth/signup", { email: "other@example.com", name: "Other", password: PASSWORD }));
    const forBen = t.tokenOf((await expectOk(t.owner.post("/members/invites", { email: "ben@example.com" }, ORIGIN))).body.link);
    const wrong = await other.post(`/invites/${forBen}`, {}, ORIGIN);
    expect([wrong.status, wrong.body.error]).toEqual([403, "invite_for_someone_else"]);
  });
});

describe("seats on Tapry Cloud", () => {
  it("follow the plan, counting the owner and open invitations", async () => {
    const t = await server({ cloud: true });
    expect((await t.owner.get("/members")).body.seats).toBe(1); // Free
    const none = await t.owner.post("/members/invites", { email: "mia@example.com" }, ORIGIN);
    expect([none.status, none.body.error]).toEqual([409, "no_free_seat"]);

    await t.setPlan("studio"); // 3 seats
    await t.join("mia@example.com");
    await expectOk(t.owner.post("/members/invites", { email: "ben@example.com" }, ORIGIN)); // open, holds the third seat
    const full = await t.owner.post("/members/invites", { email: "cy@example.com" }, ORIGIN);
    expect([full.status, full.body.error]).toEqual([409, "no_free_seat"]);
    expect(full.body.message).toContain("All 3 seats");
    // Inviting the same address again replaces its invitation, and isn't a fourth seat.
    await expectOk(t.owner.post("/members/invites", { email: "ben@example.com" }, ORIGIN));

    // A smaller plan removes nobody; it only stops new invitations.
    await t.setPlan("creator");
    expect((await t.owner.get("/members")).body).toMatchObject({ seats: 1 });
    expect((await t.owner.get("/members")).body.members).toHaveLength(2);
  });

  it("shares the account's plan and hours with its members, and keeps buying, the bucket and plans by hand with the owner", async () => {
    const t = await createServer(new FakeStorage(), {
      billing: { cloud: true, checkoutUrls: { team: "https://pay.test/team?u={user_id}" }, manageUrl: "https://pay.test/portal" },
      ownStorage: { serverKey: "a-server-key-of-enough-length", make: () => new FakeStorage(), resolve: async () => ["93.184.216.34"] },
    });
    const owner = t.client();
    const ownerUser = (await expectOk(owner.post("/auth/signup", { email: "owner@example.com", name: "Olu Owner", password: PASSWORD }))).body.user;
    const studio = (await expectOk(owner.post("/studios", { name: "The Show" }))).body;
    await expectOk(owner.put(`/admin/accounts/${ownerUser.id}/plan`, { plan: "studio" }, ORIGIN));
    const { link } = (await expectOk(owner.post("/members/invites", { email: "mia@example.com" }, ORIGIN))).body;
    const member = t.client();
    await expectOk(member.post(`/invites/${/\/invite\/([\w-]+)$/.exec(link)![1]}`, { name: "Mia Member", password: PASSWORD }, ORIGIN));
    const mia = (await member.get("/auth/me")).body.user;

    // What the member records counts against the account's hours.
    const ticket = (await expectOk(member.post(`/studios/${studio.id}/open`))).body;
    const asMember = t.client({ token: ticket.token });
    const rec = (await expectOk(asMember.post(`/sessions/${ticket.sessionId}/recordings`))).body.recording.id;
    t.tick(90 * 60_000);
    await expectOk(asMember.post(`/sessions/${ticket.sessionId}/recordings/${rec}/stop`));
    const ownersView = (await expectOk(owner.get("/billing"))).body;
    const membersView = (await expectOk(member.get("/billing"))).body;
    expect(ownersView).toMatchObject({ plan: { id: "studio", seats: 3 }, usedMs: 90 * 60_000 });
    expect(ownersView.upgrades.map((u: any) => u.url)).toEqual([`https://pay.test/team?u=${ownerUser.id}`]);
    expect(membersView).toMatchObject({ plan: { id: "studio" }, usedMs: 90 * 60_000, upgrades: [], manageUrl: null });

    // The admin's list is of accounts, and a member can't be given a plan of their own.
    expect((await owner.get("/admin/accounts")).body.accounts.map((a: any) => a.email)).toEqual(["owner@example.com"]);
    const res = await owner.put(`/admin/accounts/${mia.id}/plan`, { plan: "team" }, ORIGIN);
    expect([res.status, res.body.error]).toEqual([409, "member_of_account"]);

    // The bucket is the owner's to connect.
    await expectOk(owner.put(`/admin/accounts/${ownerUser.id}/plan`, { plan: "business" }, ORIGIN));
    const bucket = { endpoint: "https://s3.example.com", region: "auto", bucket: "our-recordings", accessKeyId: "key", secretAccessKey: "secret", forcePathStyle: true };
    const refused = await member.put("/storage/own", bucket, ORIGIN);
    expect([refused.status, refused.body.error]).toEqual([403, "owner_only"]);
    await expectOk(owner.put("/storage/own", bucket, ORIGIN));
    expect((await member.get("/storage/own")).body.target).toMatchObject({ bucket: "our-recordings" });
    expect((await member.del("/storage/own", ORIGIN)).status).toBe(403);
    expect((await member.post("/storage/own/check")).status).toBe(403);
  });
});
