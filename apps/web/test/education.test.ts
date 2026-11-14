// Education accounts (Tapry Cloud): more free hours and a discount for schools and universities.
// Verified by itself on a confirmed academic address, by an admin otherwise; nothing on a
// self-hosted server.
import { EDUCATION_FREE_HOURS } from "@tapry/shared";
import { describe, expect, it } from "vitest";
import { isAcademicEmail } from "../src/server/education";
import { createServer, expectOk } from "./harness";

const PASSWORD = "correct horse battery";
const ORIGIN = { origin: "https://app.test" };

async function cloud(opts: { discount?: string } = {}) {
  const t = await createServer(undefined, {
    allowSignup: true,
    billing: { cloud: true, paddle: { clientToken: "test_token", sandbox: true, prices: { creator: { monthly: "pri_cm" } }, educationDiscountId: opts.discount ?? null } },
  });
  const admin = t.client();
  await expectOk(admin.post("/auth/signup", { email: "admin@example.com", name: "Admin", password: PASSWORD }));
  const signup = async (email: string) => {
    const c = t.client();
    const user = (await expectOk(c.post("/auth/signup", { email, name: email.split("@")[0], password: PASSWORD }))).body.user;
    return { c, user: { ...user, accountId: user.id } };
  };
  return { ...t, admin, signup };
}

describe("education accounts", () => {
  it("knows an academic address by its domain", () => {
    for (const yes of ["a@mit.edu", "a@cs.ox.ac.uk", "a@um5.ac.ma", "a@student.unimelb.edu.au", "A@Harvard.EDU"]) expect(isAcademicEmail(yes), yes).toBe(true);
    for (const no of ["a@gmail.com", "a@education.com", "a@edu.example.com", "a@acme.co.uk", "a@uni-heidelberg.de", "nobody"]) expect(isAcademicEmail(no), no).toBe(false);
  });

  it("is verified at once on a confirmed academic address, and gives the Free plan more hours", async () => {
    const t = await cloud();
    const { c, user } = await t.signup("prof@um5.ac.ma");
    // Typing an academic address isn't enough: it has to be confirmed.
    expect((await expectOk(c.get("/billing/education"))).body).toMatchObject({ status: "none", automatic: false, owner: true, freeHours: 10, discountPercent: 30, discountActive: false });
    await t.db.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [user.id]);
    expect((await expectOk(c.get("/billing/education"))).body.automatic).toBe(true);
    expect((await expectOk(c.get("/billing"))).body.plan.hours).toBe(2);

    expect((await expectOk(c.post("/billing/education", { school: "Mohammed V University" }, ORIGIN))).body).toMatchObject({ status: "verified", school: "Mohammed V University" });
    const billing = (await expectOk(c.get("/billing"))).body;
    expect(billing.plan).toMatchObject({ id: "free", hours: EDUCATION_FREE_HOURS });
    expect(await t.services.education.isEducation(user.id)).toBe(true);
    // A paid plan's hours are its own.
    await t.db.query("UPDATE users SET plan = 'creator' WHERE id = $1", [user.id]);
    expect((await expectOk(c.get("/billing"))).body.plan.hours).toBe(15);
  });

  it("lets a free education account record past 2 hours, up to 10", async () => {
    const t = await cloud();
    const { c, user } = await t.signup("teacher@school.edu");
    const studio = (await expectOk(c.post("/studios", { name: "Class" }, ORIGIN))).body;
    const host = (await expectOk(c.post(`/studios/${studio.id}/open`, {}, ORIGIN))).body;
    const asHost = t.client({ token: host.token });
    const record = async (hours: number) => {
      const res = await asHost.post(`/sessions/${host.sessionId}/recordings`);
      if (res.status !== 201 && res.status !== 200) return res.status;
      t.tick(hours * 3_600_000);
      await expectOk(asHost.post(`/sessions/${host.sessionId}/recordings/${res.body.recording.id}/stop`));
      return res.status;
    };
    expect([200, 201]).toContain(await record(2));
    expect(await record(1)).toBe(402); // Free: 2 hours used up
    await t.db.query("UPDATE users SET education_at = now() WHERE id = $1", [user.id]);
    expect([200, 201]).toContain(await record(7.5));
    expect([200, 201]).toContain(await record(1)); // 9.5 used: still under 10
    expect(await record(1)).toBe(402);
  });

  it("waits for an admin on any other address; the admin approves, declines or takes it back", async () => {
    const t = await cloud();
    const { c, user } = await t.signup("anna@uni-heidelberg.de");
    expect((await expectOk(c.post("/billing/education", { school: "Heidelberg University" }, ORIGIN))).body.status).toBe("requested");
    expect(await t.services.education.isEducation(user.id)).toBe(false);

    // Only an admin sees and decides.
    expect((await c.get("/admin/education")).status).toBe(404);
    expect((await c.post(`/admin/education/${user.id}`, { approve: true }, ORIGIN)).status).toBe(404);
    const { requests } = (await expectOk(t.admin.get("/admin/education"))).body;
    expect(requests).toEqual([{ id: user.id, name: "anna", email: "anna@uni-heidelberg.de", school: "Heidelberg University", requestedAt: expect.any(String) }]);

    await expectOk(t.admin.post(`/admin/education/${user.id}`, { approve: true }, ORIGIN));
    expect((await expectOk(c.get("/billing/education"))).body.status).toBe("verified");
    expect((await expectOk(t.admin.get("/admin/education"))).body.requests).toEqual([]);
    // Taken back.
    await expectOk(t.admin.post(`/admin/education/${user.id}`, { approve: false }, ORIGIN));
    expect((await expectOk(c.get("/billing/education"))).body.status).toBe("none");
    expect((await t.admin.post("/admin/education/usr_nope", { approve: true }, ORIGIN)).status).toBe(404);
  });

  it("is the owner's to ask for, and opens the checkout with the education discount only for a verified account", async () => {
    const t = await cloud({ discount: "dsc_edu30" });
    const { c, user } = await t.signup("prof@school.edu");
    expect(await t.services.billing.checkoutDiscount(user)).toBeNull();
    await t.db.query("UPDATE users SET education_at = now() WHERE id = $1", [user.id]);
    expect(await t.services.billing.checkoutDiscount(user)).toBe("dsc_edu30");
    expect((await expectOk(c.get("/billing/education"))).body.discountActive).toBe(true);
    // Without a discount set up, none is applied.
    const plain = await cloud();
    const other = await plain.signup("prof@school.edu");
    await plain.db.query("UPDATE users SET education_at = now() WHERE id = $1", [other.user.id]);
    expect(await plain.services.billing.checkoutDiscount(other.user)).toBeNull();

    // A member can't ask. (A plan with seats, so there is a member at all.)
    await t.db.query("UPDATE users SET plan = 'studio' WHERE id = $1", [user.id]);
    const { link } = (await expectOk(c.post("/members/invites", { email: "mia@example.com" }, ORIGIN))).body;
    const mia = t.client();
    await expectOk(mia.post(`/invites/${/\/invite\/([\w-]+)$/.exec(link)![1]}`, { name: "Mia", password: PASSWORD }, ORIGIN));
    expect((await mia.post("/billing/education", { school: "X" }, ORIGIN)).status).toBe(403);
    expect((await expectOk(mia.get("/billing/education"))).body).toMatchObject({ status: "verified", owner: false });
  });

  it("doesn't exist on a self-hosted server", async () => {
    const t = await createServer(undefined, { allowSignup: true });
    const c = t.client();
    const user = (await expectOk(c.post("/auth/signup", { email: "host@school.edu", name: "Host", password: PASSWORD }))).body.user;
    expect((await c.get("/billing/education")).status).toBe(404);
    expect((await c.post("/billing/education", { school: "X" }, ORIGIN)).status).toBe(404);
    expect((await c.get("/admin/education")).status).toBe(404);
    expect(await t.services.education.isEducation(user.id)).toBe(false);
  });
});
