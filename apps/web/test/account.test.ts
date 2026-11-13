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
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A server that sends email, with the admin (first account) and one more host signed up. */
async function server(opts: { cloud?: boolean; mail?: boolean } = {}) {
  const mailer = new FakeMailer();
  const t = await createServer(new FakeStorage(), {
    allowSignup: true,
    ...(opts.mail === false ? {} : { mailer, appUrl: "https://studio.test/" }),
    billing: { cloud: !!opts.cloud },
  });
  const admin = t.client();
  await expectOk(admin.post("/auth/signup", { email: "admin@example.com", name: "Admin", password: PASSWORD }));
  const host = t.client();
  const signedUp = (await expectOk(host.post("/auth/signup", { email: "host@example.com", name: "Hana Host", password: PASSWORD }))).body.user;
  /** The token in the newest email's link of this kind. */
  const tokenIn = (kind: "reset" | "verify", mail = mailer.sent.at(-1)!) => new RegExp(`https://studio\\.test/${kind}/([\\w-]+)`).exec(mail.text)![1]!;
  return { ...t, mailer, admin, host, signedUp, tokenIn };
}

describe("a new password by email", () => {
  it("sends a link that sets it once, and signs every device out", async () => {
    const t = await server();
    const phone = t.client();
    await expectOk(phone.post("/auth/login", { email: "host@example.com", password: PASSWORD }));

    await expectOk(t.client().post("/auth/forgot", { email: " Host@Example.com " }, ORIGIN));
    expect(t.mailer.sent).toHaveLength(1);
    const mail = t.mailer.sent[0]!;
    expect(mail.to).toBe("host@example.com");
    expect(mail.subject).toBe("Set a new Tapry password");
    expect(mail.html).toContain(`href="https://studio.test/reset/${t.tokenIn("reset")}"`);
    const token = t.tokenIn("reset");
    // Only the link's hash is kept.
    expect(JSON.stringify(await t.db.query("SELECT * FROM account_tokens"))).not.toContain(token);

    expect((await t.client().post("/auth/reset", { token, password: "short" })).status).toBe(400);
    await expectOk(t.client().post("/auth/reset", { token, password: "a brand new password" }));

    expect((await t.host.get("/auth/me")).status).toBe(401);
    expect((await phone.get("/auth/me")).status).toBe(401);
    expect((await t.client().post("/auth/login", { email: "host@example.com", password: PASSWORD })).status).toBe(401);
    await expectOk(t.client().post("/auth/login", { email: "host@example.com", password: "a brand new password" }));
    // Used up.
    const again = await t.client().post("/auth/reset", { token, password: "yet another password" });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("link_invalid");
    // Nobody else was touched.
    expect((await t.admin.get("/auth/me")).status).toBe(200);
  });

  it("answers the same for an address without an account, and sends nothing", async () => {
    const t = await server();
    const known = await t.client().post("/auth/forgot", { email: "host@example.com" });
    const unknown = await t.client().post("/auth/forgot", { email: "nobody@example.com" });
    expect([unknown.status, unknown.body]).toEqual([known.status, known.body]);
    expect(t.mailer.sent.map((m) => m.to)).toEqual(["host@example.com"]);
  });

  it("stops working after an hour, and a newer link replaces an older one", async () => {
    const t = await server();
    await expectOk(t.client().post("/auth/forgot", { email: "host@example.com" }));
    const first = t.tokenIn("reset");
    await expectOk(t.client().post("/auth/forgot", { email: "host@example.com" }));
    const second = t.tokenIn("reset");
    expect(second).not.toBe(first);
    expect((await t.client().post("/auth/reset", { token: first, password: "a brand new password" })).status).toBe(400);

    t.tick(61 * MINUTE);
    expect((await t.client().post("/auth/reset", { token: second, password: "a brand new password" })).status).toBe(400);
    await expectOk(t.client().post("/auth/login", { email: "host@example.com", password: PASSWORD }));
  });

  it("limits how many it sends: quietly per account, and loudly per address", async () => {
    const t = await server();
    for (let i = 0; i < 5; i++) await expectOk(t.client().post("/auth/forgot", { email: "host@example.com" }));
    expect(t.mailer.sent).toHaveLength(3);
    // The address's ten are used up by now-unknown accounts too.
    for (let i = 0; i < 5; i++) await expectOk(t.client().post("/auth/forgot", { email: `nobody${i}@example.com` }));
    expect((await t.client().post("/auth/forgot", { email: "admin@example.com" })).status).toBe(429);
    t.tick(HOUR + MINUTE);
    await expectOk(t.client().post("/auth/forgot", { email: "admin@example.com" }));
    expect(t.mailer.sent.at(-1)!.to).toBe("admin@example.com");
  });

  it("isn't offered on a server that sends no email", async () => {
    const t = await server({ mail: false });
    const res = await t.client().post("/auth/forgot", { email: "host@example.com" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("email_off");
  });

  it("never fails the request, or says why, when the mail server refuses", async () => {
    const t = await server();
    t.mailer.fail = Object.assign(new Error("550 host@example.com rejected"), { code: "EENVELOPE", responseCode: 550 });
    await expectOk(t.client().post("/auth/forgot", { email: "host@example.com" }));
    expect(t.mailer.sent).toEqual([]);
  });

  it("refuses a request from another site", async () => {
    const t = await server();
    expect((await t.client().post("/auth/forgot", { email: "host@example.com" }, { origin: "https://evil.test" })).status).toBe(403);
    expect((await t.client().post("/auth/reset", { token: "x".repeat(43), password: "a brand new password" }, { origin: "https://evil.test" })).status).toBe(403);
  });
});

describe("confirming the email address", () => {
  it("is not asked on a self-hosted server: no email, nothing held back", async () => {
    const t = await server();
    expect(t.mailer.sent).toEqual([]);
    expect(t.signedUp.emailVerified).toBe(false);
    await expectOk(t.host.post("/studios", { name: "Mine" }));
    expect((await expectOk(t.host.post("/auth/verify/send"))).body).toEqual({ sent: false });
  });

  it("on Tapry Cloud: a new account gets a link, and can't create or open a studio until it is confirmed", async () => {
    const t = await server({ cloud: true });
    expect(t.mailer.sent.map((m) => [m.to, m.subject])).toEqual([["host@example.com", "Confirm your email for Tapry"]]);
    expect(t.mailer.sent[0]!.text).toContain("Hello Hana Host,");
    expect((await t.host.get("/auth/me")).body.user.emailVerified).toBe(false);

    const refused = await t.host.post("/studios", { name: "Mine" });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("email_unverified");
    // Everything they can already see still works.
    await expectOk(t.host.get("/studios"));
    await expectOk(t.host.get("/billing"));

    const token = t.tokenIn("verify");
    // No sign-in needed: the link is the proof.
    await expectOk(t.client().post("/auth/verify", { token }));
    expect((await t.host.get("/auth/me")).body.user.emailVerified).toBe(true);
    const studio = (await expectOk(t.host.post("/studios", { name: "Mine" }))).body;
    await expectOk(t.host.post(`/studios/${studio.id}/open`));
    expect((await t.client().post("/auth/verify", { token })).status).toBe(400); // used
    expect((await expectOk(t.host.post("/auth/verify/send"))).body).toEqual({ sent: false });
  });

  it("on Tapry Cloud: the first account needs no link, and an unconfirmed one can't open a studio either", async () => {
    const t = await server({ cloud: true });
    expect((await t.admin.get("/auth/me")).body.user.emailVerified).toBe(true);
    await expectOk(t.admin.post("/studios", { name: "Admin's" }));
    // A studio that somehow exists is still closed to an unconfirmed owner.
    const [{ id }] = (await t.db.query<{ id: string }>("SELECT id FROM users WHERE email = 'host@example.com'")) as [{ id: string }];
    await t.db.query("INSERT INTO studios (id, owner_id, name, invite_code) VALUES ('std_x', $1, 'X', 'code-x')", [id]);
    expect((await t.host.post("/studios/std_x/open")).status).toBe(403);
  });

  it("sends it again on request, the newest link only, a few times an hour, for three days", async () => {
    const t = await server({ cloud: true });
    const first = t.tokenIn("verify");
    expect((await expectOk(t.host.post("/auth/verify/send"))).body).toEqual({ sent: true });
    const second = t.tokenIn("verify");
    expect((await t.client().post("/auth/verify", { token: first })).status).toBe(400);
    await expectOk(t.host.post("/auth/verify/send"));
    expect((await t.host.post("/auth/verify/send")).status).toBe(429); // sign-up's + two
    expect(t.mailer.sent).toHaveLength(3);
    expect(second).not.toBe(t.tokenIn("verify"));

    const newest = t.tokenIn("verify");
    t.tick(3 * DAY + MINUTE);
    expect((await t.client().post("/auth/verify", { token: newest })).status).toBe(400);
  });

  it("a mail problem at sign-up doesn't undo the account, and setting a new password confirms the address too", async () => {
    const mailer = new FakeMailer();
    mailer.fail = Object.assign(new Error("down"), { code: "ECONNECTION" });
    const t = await createServer(new FakeStorage(), { allowSignup: true, mailer, appUrl: "https://studio.test", billing: { cloud: true } });
    await expectOk(t.client().post("/auth/signup", { email: "admin@example.com", name: "Admin", password: PASSWORD }));
    const host = t.client();
    await expectOk(host.post("/auth/signup", { email: "host@example.com", name: "Host", password: PASSWORD }));
    expect((await host.get("/auth/me")).body.user).toMatchObject({ email: "host@example.com", emailVerified: false });

    mailer.fail = null;
    await expectOk(t.client().post("/auth/forgot", { email: "host@example.com" }));
    const token = /reset\/([\w-]+)/.exec(mailer.sent.at(-1)!.text)![1]!;
    await expectOk(t.client().post("/auth/reset", { token, password: "a brand new password" }));
    const again = t.client();
    expect((await expectOk(again.post("/auth/login", { email: "host@example.com", password: "a brand new password" }))).body.user.emailVerified).toBe(true);
    await expectOk(again.post("/studios", { name: "Mine" }));
  });

  it("isn't asked on Tapry Cloud either while the server can't send email", async () => {
    const t = await server({ cloud: true, mail: false });
    await expectOk(t.host.post("/studios", { name: "Mine" }));
  });
});
