// What goes wrong on real people's computers: a second tab, joining again as someone new, and a
// recorder that stops by itself. Each should end with nothing lost.
import { randomBytes } from "node:crypto";
import { createStudio, expect, signInHost, test } from "./fixtures";
import type { Browser, BrowserContext, Page } from "@playwright/test";

test.skip(({ browserName }) => browserName !== "chromium", "the same in every engine");

async function hostAndGuest(host: Page, browser: Browser) {
  await signInHost(host);
  const { studioUrl, inviteUrl } = await createStudio(host, `Recovery ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();
  const context: BrowserContext = await browser.newContext();
  const guest = await context.newPage();
  await guest.addInitScript(trackRecorders);
  await joinAs(guest, inviteUrl, "Sam Guest");
  return { context, guest, studioUrl, inviteUrl };
}

/** Keep every MediaRecorder the page makes, so a test can stop one behind the app's back. */
function trackRecorders() {
  const MR = window.MediaRecorder;
  const w = window as unknown as { __recorders: MediaRecorder[] };
  w.__recorders = [];
  window.MediaRecorder = class extends MR {
    constructor(stream: MediaStream, options?: MediaRecorderOptions) {
      super(stream, options);
      w.__recorders.push(this);
    }
  } as typeof MediaRecorder;
}

async function joinAs(page: Page, inviteUrl: string, name: string) {
  await page.goto(inviteUrl);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^(Continue|Join as someone new)$/ }).click();
  await page.getByRole("button", { name: "Join the studio" }).click({ timeout: 20_000 });
  await expect(page.getByText("Waiting for the host to start recording.")).toBeVisible();
}

test("a second tab waits instead of recording the same person twice", async ({ page: host, browser }) => {
  const { context, guest } = await hostAndGuest(host, browser);
  const second = await context.newPage();
  await second.goto(guest.url());
  await expect(second.getByTestId("open-elsewhere")).toBeVisible();
  await expect(second.getByRole("button", { name: "Join the studio" })).toHaveCount(0);
  // Closing the first lets the second carry on by itself.
  await guest.close();
  await expect(second.getByRole("button", { name: "Join the studio" })).toBeVisible({ timeout: 20_000 });
  await context.close();
});

test("joining again as someone new doesn't strand what was recorded before", async ({ page: host, browser }) => {
  const { context, guest, inviteUrl } = await hostAndGuest(host, browser);
  await host.getByRole("button", { name: "Record", exact: true }).click();
  await expect(host.getByTestId("participant-upload").nth(1)).toContainText("Recording", { timeout: 15_000 });
  await context.setOffline(true);
  await guest.waitForTimeout(6_000); // chunks pile up on the device
  await guest.close({ runBeforeUnload: false });
  await host.getByRole("button", { name: "Stop recording" }).click();
  await context.setOffline(false);

  const back = await context.newPage();
  await joinAs(back, inviteUrl, "Sam Again");
  // The new person's ticket replaced the old one, but the old tracks still arrive.
  await expect(host.getByTestId("participant-upload").nth(1)).toContainText("✓ Uploaded", { timeout: 60_000 });
  await context.close();
});

test("a recorder that stops by itself carries on in a new track", async ({ page: host, browser }) => {
  const { context, guest, studioUrl } = await hostAndGuest(host, browser);
  await host.getByRole("button", { name: "Record", exact: true }).click();
  await expect.poll(() => guest.evaluate(() => (window as unknown as { __recorders: MediaRecorder[] }).__recorders.length), { timeout: 15_000 }).toBe(2);
  await guest.waitForTimeout(5_000);
  await guest.evaluate(() => (window as unknown as { __recorders: MediaRecorder[] }).__recorders[0]!.stop());
  // A new recorder takes over, and the alert clears once it has.
  await expect.poll(() => guest.evaluate(() => (window as unknown as { __recorders: MediaRecorder[] }).__recorders.length), { timeout: 15_000 }).toBe(3);
  await expect(guest.getByText("Recording problem:")).toHaveCount(0);
  await guest.waitForTimeout(5_000);
  await host.getByRole("button", { name: "Stop recording" }).click();
  await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/, /✓ Uploaded/], { timeout: 60_000 });
  await host.goto(studioUrl);
  await expect(host.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 120_000 });
  await context.close();
});
