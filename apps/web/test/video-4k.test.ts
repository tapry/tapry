import { studioSettings, videoTier } from "@tapry/shared";
import { describe, expect, it } from "vitest";
import { videoBitrate } from "../src/lib/client/recording";
import { neededMbps } from "../src/lib/client/tech-check";
import { buildConstraints, widescreenRequest } from "../src/lib/media/media";
import { createServer, expectOk } from "./harness";

const PASSWORD = "correct horse battery";
const ORIGIN = { origin: "https://app.test" };
const defaults = studioSettings.parse({});

describe("4K studios: each camera's best, up to 4K", () => {
  it("keeps a picture at the tier that holds it, never above the studio's and never upscaled past the camera", () => {
    // 720p and 1080p studios are their own size whatever the camera gives, as before.
    expect(videoTier("720p", 2160).height).toBe(720);
    expect(videoTier("1080p", 480).height).toBe(1080);
    // A 4K studio follows the camera.
    expect(videoTier("2160p", 2160)).toMatchObject({ height: 2160, width: 3840, bitrate: 24_000_000 });
    expect(videoTier("2160p", 1440)).toMatchObject({ height: 1440, bitrate: 14_000_000 });
    expect(videoTier("2160p", 1200).height).toBe(1440);
    expect(videoTier("2160p", 1080)).toMatchObject({ height: 1080, bitrate: 8_000_000 });
    expect(videoTier("2160p", 720).height).toBe(1080); // never under Full HD
    expect(videoTier("2160p", 4320).height).toBe(2160); // never above 4K
    expect(videoTier("2160p").height).toBe(2160); // camera unknown: the most it could be
  });

  it("asks the camera for 4K and records at the bitrate of what it really delivers", () => {
    const c = buildConstraints({ ...defaults, videoQuality: "2160p" }, { headphones: false });
    expect(c.video).toMatchObject({ width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30, max: 30 } });
    expect(videoBitrate("2160p", 2160)).toBe(24_000_000);
    expect(videoBitrate("2160p", 1080)).toBe(8_000_000); // a Full HD webcam in a 4K studio costs what Full HD costs
    expect(videoBitrate("1080p", 720)).toBe(8_000_000); // unchanged
    // The tech check warns against the most the studio could send.
    expect(neededMbps({ ...defaults, videoQuality: "2160p" })).toBeCloseTo(25, 0);
  });
});

describe("a camera without 4K in a 4K studio", () => {
  it("is asked again for a widescreen size when it answers 4K with a 4:3 mode", () => {
    const asked = { height: 2160 };
    // A laptop camera whose tallest mode is 4:3: back to its largest 16:9 size.
    expect(widescreenRequest(asked, { width: 1920, height: 1440 }, { width: { max: 1920 }, height: { max: 1440 } })).toEqual({ width: 1920, height: 1080 });
    // One that can do 1440p widescreen but answered with something square.
    expect(widescreenRequest(asked, { width: 1552, height: 1552 }, { width: { max: 3264 }, height: { max: 2448 } })).toEqual({ width: 2560, height: 1440 });
    // A browser that doesn't say what the camera can do: Full HD.
    expect(widescreenRequest(asked, { width: 1280, height: 960 }, null)).toEqual({ width: 1920, height: 1080 });
  });

  it("is left alone when the picture is widescreen already, or the studio isn't above Full HD", () => {
    expect(widescreenRequest({ height: 2160 }, { width: 3840, height: 2160 }, null)).toBeNull();
    expect(widescreenRequest({ height: 2160 }, { width: 1920, height: 1080 }, null)).toBeNull();
    expect(widescreenRequest({ height: 2160 }, { width: 1280, height: 720 }, null)).toBeNull();
    // Full HD and 720p studios behave as they always did, whatever shape the camera gives.
    expect(widescreenRequest({ height: 1080 }, { width: 1440, height: 1080 }, null)).toBeNull();
    expect(widescreenRequest({ height: 720 }, { width: 960, height: 720 }, null)).toBeNull();
    expect(widescreenRequest({ height: 2160 }, {}, null)).toBeNull();
  });
});

describe("4K and plans (Tapry Cloud)", () => {
  async function server(cloud: boolean) {
    const t = await createServer(undefined, { billing: { cloud } });
    const owner = t.client();
    const user = (await expectOk(owner.post("/auth/signup", { email: "owner@example.com", name: "Olu Owner", password: PASSWORD }))).body.user;
    const setPlan = (plan: string) => expectOk(owner.put(`/admin/accounts/${user.id}/plan`, { plan }, ORIGIN));
    return { ...t, owner, user, setPlan };
  }
  const fourK = { settings: { videoQuality: "2160p" } };

  it("is refused on a plan without it, when creating a studio and when switching one to 4K", async () => {
    const t = await server(true);
    const refused = await t.owner.post("/studios", { name: "Interviews", ...fourK }, ORIGIN);
    expect([refused.status, refused.body.error]).toEqual([402, "plan_no_4k"]);
    const studio = (await expectOk(t.owner.post("/studios", { name: "Interviews" }, ORIGIN))).body;
    expect((await t.owner.patch(`/studios/${studio.id}`, fourK, ORIGIN)).status).toBe(402);
    await t.setPlan("creator");
    expect((await t.owner.patch(`/studios/${studio.id}`, fourK, ORIGIN)).status).toBe(402);

    await t.setPlan("studio");
    expect((await expectOk(t.owner.patch(`/studios/${studio.id}`, fourK, ORIGIN))).body.settings.videoQuality).toBe("2160p");
    expect((await expectOk(t.owner.post("/studios", { name: "Films", ...fourK }, ORIGIN))).body.settings.videoQuality).toBe("2160p");
  });

  it("records in Full HD after a move to a smaller plan, and leaves the studio's settings editable", async () => {
    const t = await server(true);
    await t.setPlan("team");
    const studio = (await expectOk(t.owner.post("/studios", { name: "Films", ...fourK }, ORIGIN))).body;
    expect((await expectOk(t.owner.post(`/studios/${studio.id}/open`, {}, ORIGIN))).body.studio.settings.videoQuality).toBe("2160p");

    await t.setPlan("free");
    // The host's and the guests' devices are told Full HD; the studio keeps what was chosen.
    expect((await expectOk(t.owner.post(`/studios/${studio.id}/open`, {}, ORIGIN))).body.studio.settings.videoQuality).toBe("1080p");
    expect((await t.services.studios.invitePreview(studio.inviteCode))!.settings.videoQuality).toBe("1080p");
    const saved = (await expectOk(t.owner.patch(`/studios/${studio.id}`, { settings: { maxGuests: 2 } }, ORIGIN))).body.settings;
    expect([saved.videoQuality, saved.maxGuests]).toEqual(["2160p", 2]);
  });

  it("has no such limit on a self-hosted server", async () => {
    const t = await server(false);
    const studio = (await expectOk(t.owner.post("/studios", { name: "Films", ...fourK }, ORIGIN))).body;
    expect((await expectOk(t.owner.post(`/studios/${studio.id}/open`, {}, ORIGIN))).body.studio.settings.videoQuality).toBe("2160p");
  });
});
