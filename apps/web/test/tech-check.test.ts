import { SPEED_TEST_MAX_BYTES, studioSettings } from "@tapry/shared";
import { describe, expect, it } from "vitest";
import { describeBrowser, neededMbps, uploadCheck } from "../src/lib/client/tech-check";
import { expectOk, setup } from "./harness";

const settings = studioSettings.parse({});

describe("tech check (in the browser)", () => {
  it("knows what each kind of studio sends while recording", () => {
    expect(neededMbps(settings)).toBeCloseTo(9.0, 0); // 8 Mbit/s 1080p, two audio tracks, the call
    expect(neededMbps({ ...settings, videoQuality: "720p" })).toBeCloseTo(5.0, 0);
    expect(neededMbps({ ...settings, audioOnly: true })).toBeLessThan(0.5);
  });

  it("calls a slow upload a warning, never a blocker: the recording is safe either way", () => {
    expect(uploadCheck(20, settings)).toMatchObject({ tone: "ok", label: "Upload 20 Mbit/s: keeps up with the recording" });
    expect(uploadCheck(6, settings)).toMatchObject({ tone: "warn", label: expect.stringMatching(/may finish uploading after the session/) });
    expect(uploadCheck(1, settings)).toMatchObject({ tone: "warn", label: expect.stringMatching(/Your recording is safe/) });
    expect(uploadCheck(1, { ...settings, audioOnly: true }).tone).toBe("ok"); // plenty for sound only
    expect(uploadCheck(null, settings).tone).toBe("danger");
  });

  it("names the browser and system for the host", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    const win = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0";
    const android = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
    const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";
    expect([mac, win, android, firefox].map(describeBrowser)).toEqual([
      "Safari on macOS",
      "Edge on Windows",
      "Chrome on Android",
      "Firefox on Linux",
    ]);
  });
});

describe("tech check (server)", () => {
  const report = (reportId: string, name: string, tone: "ok" | "warn" = "ok") => ({
    reportId,
    name,
    browser: "Chrome on macOS",
    checks: [{ id: "upload", tone, label: tone === "ok" ? "Upload 20 Mbit/s" : "Upload 1 Mbit/s" }],
  });

  it("takes upload-speed test data for a live invite only, and only so much", async () => {
    const t = await setup();
    const post = (code: string, bytes: number) =>
      t.fetchFor()(`https://app.test/api/check/${code}/upload`, { method: "POST", body: new Uint8Array(bytes) });
    const ok = await post(t.studio.inviteCode, 1024 * 1024);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ bytes: 1024 * 1024 });
    expect((await post("not-a-real-code", 10)).status).toBe(404);
    expect((await post(t.studio.inviteCode, SPEED_TEST_MAX_BYTES + 1)).status).toBe(413);
  });

  it("shows the host what guests sent, newest first; sending again updates the same report", async () => {
    const t = await setup();
    const guest = t.client();
    await expectOk(guest.post(`/check/${t.studio.inviteCode}/report`, report("chk_aaaaaaaaaa", "Sam", "warn")));
    t.tick(1000);
    await expectOk(guest.post(`/check/${t.studio.inviteCode}/report`, report("chk_bbbbbbbbbb", "Alex")));
    await expectOk(guest.post(`/check/${t.studio.inviteCode}/report`, report("chk_aaaaaaaaaa", "Sam", "ok"))); // fixed it, sent again

    const host = (await expectOk(t.hostBrowser.get("/auth/me"))).body.user;
    const checks = await t.services.studios.techChecks(host, t.studio.id);
    expect(checks.map((c) => [c.name, c.checks[0]!.tone])).toEqual([
      ["Sam", "ok"],
      ["Alex", "ok"],
    ]);
    expect((await guest.post("/check/not-a-real-code/report", report("chk_cccccccccc", "Kim"))).status).toBe(404);
    expect((await guest.post(`/check/${t.studio.inviteCode}/report`, { ...report("chk_dddddddddd", "Kim"), checks: [] })).status).toBe(400);
  });

  it("keeps a report to its own studio, and goes with the studio", async () => {
    const t = await setup();
    const other = (await expectOk(t.hostBrowser.post("/studios", { name: "Other studio" }))).body;
    await expectOk(t.client().post(`/check/${t.studio.inviteCode}/report`, report("chk_aaaaaaaaaa", "Sam")));
    // The same id through another studio's link can't take the report over.
    expect((await t.client().post(`/check/${other.inviteCode}/report`, report("chk_aaaaaaaaaa", "Mallory"))).status).toBe(409);

    await expectOk(t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
    await expectOk(t.hostBrowser.del(`/studios/${t.studio.id}`));
    expect(await t.db.query("SELECT id FROM tech_checks")).toEqual([]);
  });

  it("keeps the newest 50 reports per studio", async () => {
    const t = await setup();
    for (let i = 0; i < 55; i++) {
      await expectOk(t.client().post(`/check/${t.studio.inviteCode}/report`, report(`chk_${String(i).padStart(10, "0")}`, `Guest ${i}`)));
    }
    const [row] = await t.db.query<{ n: number }>("SELECT count(*)::int AS n FROM tech_checks");
    expect(row!.n).toBe(50);
  });
});
