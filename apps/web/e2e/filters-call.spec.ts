// A person's picture filters in the live call, in this project's browser. Safari has no canvas
// `filter`, so on iPhones and in Safari the live picture used to stay as it was (only the files
// got the filters; owner's test, 16 Nov 2026). Now every engine draws them: here black and
// white, checked on the person's own view and on what a Chromium guest receives.
import { randomBytes } from "node:crypto";
import { chromium, type Locator } from "@playwright/test";
import { createStudio, expect, otherPerson, signInHost, test } from "./fixtures";

test.skip(!process.env.LIVEKIT_E2E_URL, "needs a LiveKit server (set LIVEKIT_BIN)");

/** How far from grey the picture is: the largest gap between colour channels, over a grid of points. */
const colourfulness = (picture: Locator) =>
  picture.evaluate((el) => {
    const src = el as HTMLVideoElement | HTMLCanvasElement;
    const w = "videoWidth" in src ? src.videoWidth : src.width;
    const h = "videoHeight" in src ? src.videoHeight : src.height;
    if (!w || !h) return -1;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 36;
    const x = c.getContext("2d")!;
    x.drawImage(src, 0, 0, 64, 36);
    const d = x.getImageData(0, 0, 64, 36).data;
    let most = 0;
    for (let i = 0; i < d.length; i += 4) most = Math.max(most, Math.abs(d[i]! - d[i + 1]!), Math.abs(d[i + 1]! - d[i + 2]!), Math.abs(d[i]! - d[i + 2]!));
    return most;
  });

test("black and white shows live, on your own view and in the call", async ({ page: host }) => {
  test.setTimeout(150_000);
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `Filters ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click();

  const browser = await chromium.launch({ channel: "chromium", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--mute-audio"] });
  try {
    const guest = await (await otherPerson(browser, { permissions: ["camera", "microphone"] })).newPage();
    await guest.goto(inviteUrl);
    await guest.getByLabel("Your name").fill("Viewer");
    await guest.getByRole("checkbox").check();
    await guest.getByRole("button", { name: "Continue" }).click();
    await guest.getByRole("button", { name: "Join the studio" }).click();
    const received = guest.locator('[data-testid="remote-tile"][data-name="Dev Host"] video');
    await expect(received).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => colourfulness(received), { timeout: 20_000, message: "the test camera is in colour" }).toBeGreaterThan(40);

    await host.getByRole("button", { name: /^Filters/ }).first().click();
    await expect(host.getByTestId("filters-no-preview")).toHaveCount(0);
    await host.getByText("Black & white", { exact: true }).click();

    const own = host.getByTestId("self-tile").getByTestId("filtered-picture");
    await expect(own).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => colourfulness(own), { timeout: 10_000, message: "own view in black and white" }).toBeLessThan(12);
    await expect.poll(() => colourfulness(received), { timeout: 20_000, message: "the guest sees black and white" }).toBeLessThan(16);
  } finally {
    await browser.close();
  }
});
