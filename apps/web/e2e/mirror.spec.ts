// "Others see me mirrored": a guest asks to be shown flipped, and the host's screen shows them
// flipped, also when the host joins after the choice was made; switched off, it's as the camera
// sees them again. The recorder's track isn't touched: the finished video is flipped by the
// worker for the time it was on (apps/worker tests).
import { randomBytes } from "node:crypto";
import { chromium, type Locator, type Page } from "@playwright/test";
import { createStudio, expect, otherPerson, signInHost, test } from "./fixtures";

test.skip(!process.env.LIVEKIT_E2E_URL, "needs a LiveKit server (set LIVEKIT_BIN)");

const flipped = (video: Locator) => video.evaluate((v) => getComputedStyle(v).scale.startsWith("-1"));
const tile = (page: Page, name: string) => page.locator(`[data-testid="remote-tile"][data-name="${name}"]`).locator("video");

test("a guest shown mirrored on everyone's screen", async ({ page: host }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium" && !process.env.E2E_ALL, "the tile's flip is plain CSS, the same everywhere");
  test.setTimeout(150_000);
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `Mirror ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click();

  const browser = await chromium.launch({ channel: "chromium", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--mute-audio"] });
  try {
    const guest = await (await otherPerson(browser, { permissions: ["camera", "microphone"] })).newPage();
    await guest.goto(inviteUrl);
    await guest.getByLabel("Your name").fill("Mira");
    await guest.getByRole("checkbox").check();
    await guest.getByRole("button", { name: "Continue" }).click();
    await guest.getByRole("button", { name: "Join the studio" }).click();
    await expect(tile(host, "Mira")).toBeVisible({ timeout: 30_000 });
    expect(await flipped(tile(host, "Mira"))).toBe(false); // off by default

    await guest.getByRole("button", { name: /^Filters/ }).first().click();
    await guest.getByRole("switch", { name: "Others see me mirrored" }).click();
    await expect.poll(() => flipped(tile(host, "Mira")), { timeout: 15_000 }).toBe(true);

    // The host comes back: it's kept by the server, not only sent to who was there.
    await host.reload();
    await host.getByRole("button", { name: "Enter the studio" }).click().catch(() => {});
    await expect(tile(host, "Mira")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => flipped(tile(host, "Mira")), { timeout: 15_000 }).toBe(true);

    await guest.getByRole("switch", { name: "Others see me mirrored" }).click();
    await expect.poll(() => flipped(tile(host, "Mira")), { timeout: 15_000 }).toBe(false);
  } finally {
    await browser.close();
  }
});
