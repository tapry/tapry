// A guest on a phone: the whole way from the invite to the end screen at a phone's size with
// touch, nothing wider than the screen, the main buttons big enough for a thumb, and the
// recording arriving like anyone's. Also branding: the studio's colour and logo on the guest's
// pages. (Chromium at a phone's size: a real iPhone or Android phone has not been tried.)
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { createStudio, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "the same in every engine");

const SHOTS = "test-results/phone";
// 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

/** Nothing on the page reaches past the screen's width. */
async function fits(page: Page, where: string) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `${where}: page is wider than the screen`).toBeLessThanOrEqual(inner);
  await page.screenshot({ path: `${SHOTS}/${where}.png` });
}

test("a guest on a phone joins, is recorded and sees the end screen; the studio's brand is on their pages", async ({ page: host, browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `Phone ${randomBytes(2).toString("hex")}`);

  // Branding, from the studio's settings.
  await host.getByRole("tab", { name: "Settings" }).click();
  await host.getByTestId("brand-accent").fill("#1d4ed8");
  await host.getByRole("button", { name: "Use this colour" }).click();
  await expect(host.getByTestId("brand-editor").getByText("✓ Saved")).toBeVisible();
  await host.getByTestId("brand-logo-file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(host.getByRole("button", { name: "Replace logo" })).toBeVisible();
  // Not an image: refused, in words.
  await host.getByTestId("brand-logo-file").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
  await expect(host.getByTestId("brand-editor").getByText("The logo must be a PNG, JPEG or WebP image.")).toBeVisible();

  await host.getByRole("tab", { name: "Recordings" }).click();
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, permissions: ["camera", "microphone"] });
  const guest = await phone.newPage();
  await guest.goto(inviteUrl);
  // The studio's logo and colour.
  await expect(guest.getByTestId("brand-logo")).toBeVisible();
  expect(await guest.getByTestId("brand-logo").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1);
  expect(await guest.evaluate(() => getComputedStyle(document.querySelector(".branded")!).getPropertyValue("--accent").trim())).toBe("#1d4ed8");
  await expect(guest.getByText("You'll be recorded on this device")).toBeVisible();
  await fits(guest, "1-invite");
  // Fields are 16 px on touch screens, so iOS doesn't zoom into them.
  expect(await guest.getByLabel("Your name").evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
  await guest.getByLabel("Your name").fill("Sam Guest");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).tap();

  const join = guest.getByRole("button", { name: "Join the studio" });
  await expect(join).toBeEnabled({ timeout: 20_000 });
  await expect(guest.getByTestId("brand-logo")).toBeVisible();
  await fits(guest, "2-green-room");
  expect((await join.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await join.tap();
  await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();
  await fits(guest, "3-room-waiting");

  await host.getByRole("button", { name: "Record", exact: true }).click();
  await expect(guest.getByText("You're being recorded.")).toBeVisible({ timeout: 20_000 });
  await guest.waitForTimeout(4_000);
  await fits(guest, "4-room-recording");
  // The controls a guest needs are on screen and thumb-sized.
  for (const name of ["Mute", "Turn camera off"]) {
    const box = (await guest.getByRole("button", { name, exact: true }).boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(40);
    expect(box.x + box.width, name).toBeLessThanOrEqual(390);
  }
  await host.getByRole("button", { name: "Stop recording" }).click();
  await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/, /✓ Uploaded/], { timeout: 60_000 });
  host.once("dialog", (d) => d.accept());
  await host.getByRole("button", { name: "End session" }).click();
  await expect(guest.getByTestId("session-ended")).toContainText("All done!", { timeout: 30_000 });
  await fits(guest, "5-end");
  await phone.close();
});
