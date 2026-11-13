// The host's guide (run of show) and markers on the running recording.
import { beforeEach, describe, expect, it } from "vitest";
import { markerLabel, parseGuide } from "../src/lib/guide";
import { setup } from "./harness";

const ORIGIN = { origin: "https://app.test" };
const GUIDE = "# Opening\nIntroduce the guest\n- What got you started?\n\n# Main part\nThe hard year";

describe("the guide", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });
  const as = (token: string) => t.client({ token });

  it("reads as sections and items to tick", () => {
    expect(parseGuide(GUIDE)).toEqual([
      { kind: "section", text: "Opening" },
      { kind: "item", text: "Introduce the guest" },
      { kind: "item", text: "What got you started?" },
      { kind: "section", text: "Main part" },
      { kind: "item", text: "The hard year" },
    ]);
    expect(parseGuide("  \n\n")).toEqual([]);
    expect(markerLabel(`Line\u0000 one\n${"x".repeat(300)}`).length).toBe(200);
  });

  it("is saved with the studio and reaches hosts in the room, never guests", async () => {
    expect((await t.hostBrowser.get(`/studios/${t.studio.id}/guide`)).body).toEqual({ guide: "" });
    expect((await t.hostBrowser.put(`/studios/${t.studio.id}/guide`, { guide: GUIDE }, ORIGIN)).body).toEqual({ guide: GUIDE });
    expect((await as(t.host.token).get(`/sessions/${t.sessionId}/guide`)).body).toEqual({ guide: GUIDE });
    expect((await as(t.guest.token).get(`/sessions/${t.sessionId}/guide`)).status).toBe(403);
    // Not in what a guest's device is handed either.
    const joined = (await t.client().post("/join", { inviteCode: t.studio.inviteCode, displayName: "Second", consent: true })).body;
    expect(JSON.stringify(joined)).not.toContain("Introduce the guest");
    expect((await t.hostBrowser.put(`/studios/${t.studio.id}/guide`, { guide: "x".repeat(8001) }, ORIGIN)).status).toBe(400);
    expect((await t.client().get(`/studios/${t.studio.id}/guide`)).status).toBe(401);
  });
});

describe("markers", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });
  const as = (token: string) => t.client({ token });
  const mark = (token: string, label?: string) => as(token).post(`/sessions/${t.sessionId}/markers`, label === undefined ? {} : { label });
  const owner = async () => {
    const [u] = await t.db.query<{ id: string; email: string; name: string; is_admin: boolean }>("SELECT id, email, name, is_admin FROM users");
    return { id: u!.id, email: u!.email, name: u!.name, isAdmin: u!.is_admin, emailVerified: true, accountId: u!.id };
  };

  it("are set by a host while the recording runs, timed from its start by the server", async () => {
    t.tick(12_500);
    const first = await mark(t.host.token, "What got you started?");
    expect([first.status, first.body]).toEqual([201, { id: expect.stringMatching(/^mrk_/), atMs: 12_500, label: "What got you started?" }]);
    t.tick(30_000);
    expect((await mark(t.host.token)).body).toMatchObject({ atMs: 42_500, label: "Marker" });
    expect((await mark(t.guest.token, "Mine")).status).toBe(403);
    expect((await t.services.guide.markers(await owner(), t.recordingId)).map((m) => [m.atMs, m.label])).toEqual([
      [12_500, "What got you started?"],
      [42_500, "Marker"],
    ]);
  });

  it("can't be set when nothing is being recorded, and go with their recording", async () => {
    await mark(t.host.token, "Kept until deleted");
    await as(t.host.token).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
    expect(await mark(t.host.token, "Too late")).toMatchObject({ status: 409, body: { error: "not_recording" } });
    await t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`);
    expect(await t.db.query("SELECT 1 FROM markers")).toEqual([]);
  });
});
