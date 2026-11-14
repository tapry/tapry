// Comments on recordings, and the account's activity log.
import { beforeEach, describe, expect, it } from "vitest";
import { expectOk, setup } from "./harness";

const ORIGIN = { origin: "https://app.test" };
const PASSWORD = "correct horse battery";

describe("comments on a recording", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });
  const path = () => `/recordings/${t.recordingId}/comments`;
  async function member(email: string, role = "member") {
    const { link } = (await expectOk(t.hostBrowser.post("/members/invites", { email, role }, ORIGIN))).body;
    const m = t.client();
    await expectOk(m.post(`/invites/${/\/invite\/([\w-]+)$/.exec(link)![1]}`, { name: email.split("@")[0], password: PASSWORD }, ORIGIN));
    return m;
  }

  it("are written by anyone in the account, viewers too, optionally at a moment, and listed in order", async () => {
    const vera = await member("vera@example.com", "viewer");
    expect((await t.hostBrowser.post(path(), { body: "Great answer here", atMs: 65_000 }, ORIGIN)).status).toBe(201);
    expect((await vera.post(path(), { body: "  Check the name at the start  " }, ORIGIN)).status).toBe(201);
    const seen = (await vera.get(path())).body.comments;
    expect(seen.map((c: any) => [c.author, c.atMs, c.body, c.mine])).toEqual([["Host", 65_000, "Great answer here", false], ["vera", null, "Check the name at the start", true]]);
    expect((await t.hostBrowser.post(path(), { body: "   " }, ORIGIN)).status).toBe(400);
    expect((await t.client().get(path())).status).toBe(401);
  });

  it("are deleted by their author or the account's owner, and go with the recording", async () => {
    const mia = await member("mia@example.com");
    await mia.post(path(), { body: "Mine" }, ORIGIN);
    await t.hostBrowser.post(path(), { body: "The owner's" }, ORIGIN);
    const [mine, owners] = (await mia.get(path())).body.comments;
    expect((await mia.del(`${path()}/${owners.id}`, ORIGIN)).status).toBe(404); // not hers
    expect((await t.hostBrowser.del(`${path()}/${mine.id}`, ORIGIN)).status).toBe(204); // the owner may
    await t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
    await t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`);
    expect(await t.db.query("SELECT 1 FROM comments")).toEqual([]);
  });
});

describe("activity log", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });
  const log = async () => (await t.hostBrowser.get("/activity")).body.activity.map((a: any) => [a.who, a.action, a.target]);

  it("records changes that went through, with the thing's name as it was, newest first", async () => {
    await t.hostBrowser.patch(`/studios/${t.studio.id}`, { name: "Renamed" }, ORIGIN);
    await t.hostBrowser.put(`/studios/${t.studio.id}/guide`, { guide: "x".repeat(9000) }, ORIGIN); // refused: not recorded
    await t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
    await t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`);
    expect(await log()).toEqual([
      ["Host", "Deleted a recording", "Renamed, Recording 1"],
      ["Host", "Changed a studio", "My Podcast"], // named before the change
      ["Host", "Created a studio", ""],
    ]);
  });

  it("works for requests whose address has no parameters, as the web server sends them", async () => {
    const res = await t.api.createStudio(
      new Request("https://app.test/api/studios", { method: "POST", headers: { "content-type": "application/json", cookie: `ot_session=${t.hostBrowser.jar.get("ot_session")}` }, body: JSON.stringify({ name: "Second" }) }),
      undefined as never,
    );
    expect(res.status).toBe(201);
    expect((await log())[0]).toEqual(["Host", "Created a studio", ""]);
  });

  it("is the owner's to read, and holds no one else's account", async () => {
    const { link } = (await expectOk(t.hostBrowser.post("/members/invites", { email: "mia@example.com" }, ORIGIN))).body;
    const mia = t.client();
    await expectOk(mia.post(`/invites/${/\/invite\/([\w-]+)$/.exec(link)![1]}`, { name: "Mia", password: PASSWORD }, ORIGIN));
    await mia.patch(`/studios/${t.studio.id}`, { name: "By Mia" }, ORIGIN);
    expect((await mia.get("/activity")).status).toBe(403);
    expect((await log())[0]).toEqual(["Mia", "Changed a studio", "My Podcast"]);
    expect((await log()).map((a: string[]) => a[1])).toContain("Invited someone to the account");
  });

  it("downloads as a CSV for the owner, oldest first, with nothing a spreadsheet would run", async () => {
    await t.hostBrowser.patch(`/studios/${t.studio.id}`, { name: '=HYPERLINK("x"), Inc' }, ORIGIN);
    await t.hostBrowser.patch(`/studios/${t.studio.id}`, { name: "Plain" }, ORIGIN);
    const user = (await expectOk(t.hostBrowser.get("/auth/me"))).body.user;
    const lines = (await t.services.activity.csv(user)).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Time (UTC),Who,Action,On");
    expect(lines.slice(1).map((l) => l.replace(/^[^,]+,/, ""))).toEqual([
      "Host,Created a studio,",
      "Host,Changed a studio,My Podcast",
      `Host,Changed a studio,"'=HYPERLINK(""x""), Inc"`,
    ]);
    expect(lines[1]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z,/);

    const res = await t.api.listActivity(new Request("https://app.test/api/activity?format=csv", { headers: { cookie: `ot_session=${t.hostBrowser.jar.get("ot_session")}` } }), {});
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain("Tapry activity log.csv");
    expect(await res.text()).toContain("Changed a studio");
  });
});
