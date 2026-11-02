// The guest tech check: the host sends the link before the session, the guest tests their setup
// (devices, browser, upload speed, a test recording played back) and sends the results, which
// the host then sees on the show page.
import { randomBytes } from "node:crypto";
import { createStudio, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "the same page in every engine");

test("a guest tests their setup before the session and the host sees how it went", async ({ page: host, browser }) => {
  await signInHost(host);
  const { studioUrl } = await createStudio(host, `Check ${randomBytes(2).toString("hex")}`);
  const checkUrl = await host.getByLabel("Tech-check link").inputValue();
  expect(checkUrl).toMatch(/\/join\/[\w-]+\/check$/);
  await expect(host.getByText("Tech checks")).toHaveCount(0); // nothing yet

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(checkUrl);
  await expect(guest.getByRole("heading", { name: /Test your setup for/ })).toBeVisible();

  const checks = guest.getByRole("list", { name: "Checks" });
  await expect(checks.locator('[data-check="camera"]')).toHaveAttribute("data-tone", "ok", { timeout: 20_000 });
  await expect(checks.locator('[data-check="upload"]')).toContainText(/Upload [\d.]+ Mbit\/s/, { timeout: 30_000 });
  await expect(checks.locator('[data-check="network"]')).toHaveAttribute("data-tone", "ok");

  await test.step("hear yourself: a test recording plays back on the spot", async () => {
    const hear = guest.getByTestId("hear-yourself");
    await hear.getByRole("button", { name: "Record a test" }).click();
    await expect(hear.getByRole("button", { name: /Recording… \d/ })).toBeVisible();
    const audio = hear.locator("audio");
    await expect(audio).toBeVisible({ timeout: 10_000 });
    // It really holds the few seconds just recorded (Chrome reports such a file's duration as
    // Infinity, so look at its size: 5 s of Opus is tens of kB).
    const bytes = await audio.evaluate(async (a: HTMLAudioElement) => (await (await fetch(a.src)).blob()).size);
    expect(bytes).toBeGreaterThan(20_000);
    await hear.getByRole("button", { name: "Clear" }).click();
    await expect(checks.locator('[data-check="playback"]')).toHaveAttribute("data-tone", "ok");
  });

  await guest.getByLabel("I'll wear headphones").check();
  await guest.getByLabel("Your name").fill("Sam Guest");
  await guest.getByRole("button", { name: /Send results to/ }).click();
  await expect(guest.getByTestId("check-sent")).toBeVisible();

  await host.goto(studioUrl);
  const row = host.getByTestId("tech-check").filter({ hasText: "Sam Guest" });
  await expect(row).toContainText("Chrome on");
  // The fake mic's beeps may or may not count as "heard"; anything else should be fine on this machine.
  const issues = await row.locator("li").allTextContents();
  expect(issues.filter((t) => !/haven't heard you/.test(t))).toEqual([]);
  await guestContext.close();
});
