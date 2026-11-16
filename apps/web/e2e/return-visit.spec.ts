// A guest who comes back (same browser, the invite link again) has a remembered device choice.
// The green room used to ask for the camera with the defaults, then again with that choice
// while the first request was still open. On an iPhone the two requests fight over the one
// camera, and the picture that was kept could stay black with the camera on (found in the
// owner's own test session, 16 Nov 2026). The camera is now asked for one request at a time.
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { createStudio, expect, signInHost, test } from "./fixtures";

/** Counts camera requests open at the same time; each is slowed down so an overlap can't hide. */
const watchCameraRequests = (page: Page) =>
  page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    const seen = { open: 0, most: 0, total: 0 };
    (window as unknown as { cameraRequests: typeof seen }).cameraRequests = seen;
    md.getUserMedia = async (c) => {
      seen.total++;
      seen.most = Math.max(seen.most, ++seen.open);
      try {
        await new Promise((r) => setTimeout(r, 400));
        return await real(c);
      } finally {
        seen.open--;
      }
    };
  });

test("a returning guest's camera is asked for one request at a time, and their picture is live", async ({ page: host, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "the request order is ours, not the engine's");
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `Return ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click();

  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const guest = await context.newPage();
  await watchCameraRequests(guest);
  const visit = async () => {
    await guest.goto(inviteUrl);
    await guest.getByLabel("Your name").fill("Rita");
    await guest.getByRole("checkbox").check();
    await guest.getByRole("button", { name: "Continue" }).click();
    await expect(guest.getByRole("button", { name: "Join the studio" })).toBeEnabled({ timeout: 30_000 });
  };

  await visit();
  // A choice the device remembers for the next visit, and that changes what is asked of the mic.
  await guest.getByRole("checkbox", { name: /headphones/i }).check();
  await expect(guest.getByRole("button", { name: "Join the studio" })).toBeEnabled({ timeout: 30_000 });

  await visit();
  const seen = await guest.evaluate(() => (window as unknown as { cameraRequests: { most: number; total: number } }).cameraRequests);
  expect(seen.total, "the remembered choice is used").toBeGreaterThanOrEqual(1);
  expect(seen.most, "camera requests open at once").toBe(1);
  await expect(guest.getByRole("checkbox", { name: /headphones/i })).toBeChecked();
  const preview = guest.locator("video").first();
  await expect.poll(() => preview.evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
  expect(await preview.evaluate((v) => ((v as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]!.readyState)).toBe("live");
  await context.close();
});
