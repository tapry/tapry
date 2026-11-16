// Turning the camera off and on again during a call: the others see the picture come back.
// On an iPhone the call's copy of the camera could stay dark after that while the person's own
// view was back (owner's test, 16 Nov 2026); Apple's WebKit now gets a fresh copy. Runs with this
// project's browser as the one switching its camera, and a Chromium guest watching.
import { randomBytes } from "node:crypto";
import { chromium, type Locator } from "@playwright/test";
import { createStudio, expect, signInHost, test } from "./fixtures";

test.skip(!process.env.LIVEKIT_E2E_URL, "needs a LiveKit server (set LIVEKIT_BIN)");

/** Frames the video showed in the next second. */
const framesInASecond = (video: Locator) =>
  video.evaluate(async (el) => {
    const v = el as HTMLVideoElement;
    const count = () => v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    const before = count();
    await new Promise((r) => setTimeout(r, 1000));
    return count() - before;
  });

test("the camera turned off and on again comes back for the others", async ({ page: host }) => {
  test.setTimeout(180_000);
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `Camera ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click();

  const browser = await chromium.launch({ channel: "chromium", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--mute-audio"] });
  try {
    const guest = await (await browser.newContext({ permissions: ["camera", "microphone"] })).newPage();
    await guest.goto(inviteUrl);
    await guest.getByLabel("Your name").fill("Watcher");
    await guest.getByRole("checkbox").check();
    await guest.getByRole("button", { name: "Continue" }).click();
    await guest.getByRole("button", { name: "Join the studio" }).click();

    const hostTile = guest.locator('[data-testid="remote-tile"][data-name="Dev Host"]');
    await expect(hostTile.locator("video")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => framesInASecond(hostTile.locator("video")), { timeout: 30_000 }).toBeGreaterThan(5);

    for (let round = 1; round <= 2; round++) {
      await host.getByRole("button", { name: "Turn camera off" }).click();
      await expect(hostTile.locator("video")).toHaveCount(0, { timeout: 15_000 });
      await host.getByRole("button", { name: "Turn camera on" }).click();
      await expect(hostTile.locator("video")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => framesInASecond(hostTile.locator("video")), { timeout: 20_000, message: `picture back after round ${round}` }).toBeGreaterThan(5);
    }
    // The recorder's camera was switched with it, and is live again.
    expect(await host.getByTestId("self-tile").locator("video").evaluate((v) => ((v as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]!.readyState)).toBe("live");
  } finally {
    await browser.close();
  }
});
