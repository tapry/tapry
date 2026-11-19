// The host's view of a guest in the call: the picture keeps playing through every layout, and
// a guest whose connection dies is shown as interrupted, not as a frozen last frame.
// Found in the owner's own test session (16 Nov 2026). Needs LiveKit (LIVEKIT_BIN).
import { randomBytes } from "node:crypto";
import { chromium, type Locator, type Page } from "@playwright/test";
import { createStudio, expect, otherPerson, signInHost, test } from "./fixtures";

test.skip(!process.env.LIVEKIT_E2E_URL, "needs a LiveKit server (set LIVEKIT_BIN)");

const tile = (page: Page, name: string) => page.locator(`[data-testid="remote-tile"][data-name="${name}"]`);

/** Frames the video showed in the next second. */
const framesInASecond = (video: Locator) =>
  video.evaluate(async (el) => {
    const v = el as HTMLVideoElement;
    // Firefox's frame counter stays at zero for a live picture: count its per-frame callbacks too.
    let called = 0;
    const each = () => {
      called++;
      v.requestVideoFrameCallback?.(each);
    };
    v.requestVideoFrameCallback?.(each);
    const before = v.getVideoPlaybackQuality().totalVideoFrames;
    await new Promise((r) => setTimeout(r, 1000));
    return Math.max(called, v.getVideoPlaybackQuality().totalVideoFrames - before);
  });

test("a guest's picture plays in every layout, and says so when their connection dies", async ({ page: host }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium" && !process.env.E2E_ALL, "one engine is enough for the tile's own logic");
  test.setTimeout(180_000);
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `Drop ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click();

  // A browser of its own, so it can be killed like a laptop losing power: no goodbye to the call.
  const server = await chromium.launchServer({ channel: "chromium", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--mute-audio"] });
  try {
    const browser = await chromium.connect(server.wsEndpoint());
    const guest = await (await otherPerson(browser, { permissions: ["camera", "microphone"] })).newPage();
    await guest.goto(inviteUrl);
    await guest.getByLabel("Your name").fill("Gina");
    await guest.getByRole("checkbox").check();
    await guest.getByRole("button", { name: "Continue" }).click();
    await guest.getByRole("button", { name: "Join the studio" }).click();
    await expect(host.getByTestId("call-status")).toHaveText(/Call: connected/, { timeout: 30_000 });

    const video = tile(host, "Gina").locator("video");
    await expect(video).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => framesInASecond(video), { timeout: 30_000 }).toBeGreaterThan(10);

    await test.step("the picture keeps playing while the host switches layouts", async () => {
      for (const name of ["Speaker", "Side by side", "Grid", "Speaker", "Grid", "Side by side", "Grid"]) {
        await host.getByRole("button", { name, exact: true }).click();
        expect(await framesInASecond(video), `after choosing ${name}`).toBeGreaterThan(10);
        await expect(video).toHaveAttribute("data-picture", "live");
      }
      // Flipped quickly, with no time to settle in between.
      for (const name of ["Speaker", "Side by side", "Grid", "Side by side", "Speaker", "Grid"]) await host.getByRole("button", { name, exact: true }).click();
      await expect.poll(() => framesInASecond(video)).toBeGreaterThan(10);
    });

    await test.step("the guest's device dies: their tile says the picture is interrupted until they are gone", async () => {
      server.process().kill("SIGKILL");
      await expect(tile(host, "Gina").getByTestId("picture-stalled")).toHaveText("Picture interrupted", { timeout: 15_000 });
      await expect(video).toHaveAttribute("data-picture", "stalled");
      // The call server gives up on them after a while and the tile goes.
      await expect(tile(host, "Gina")).toHaveCount(0, { timeout: 60_000 });
    });
  } finally {
    await server.close().catch(() => {});
  }
});
