// In-call quality alerts: a guest's device reports what it sees, the host gets it next to their name.
import { randomBytes } from "node:crypto";
import { createStudio, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "same reporting in every engine");

test("the host sees a guest's alerts, and when their device stops reporting", async ({ page: host, browser }) => {
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `Alerts ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(inviteUrl);
  await guest.getByLabel("Your name").fill("Alex Guest");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.getByLabel("I'm wearing headphones").uncheck();
  await guest.getByRole("button", { name: "Join the studio" }).click();
  await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();

  const guestRow = host.getByTestId("participant").filter({ hasText: "Alex Guest" });
  await test.step("no headphones shows as a note", async () => {
    await expect(guestRow.locator('[data-alert="no_headphones"]')).toBeVisible({ timeout: 10_000 });
  });

  await test.step("the guest's tab goes to the background: the host is told at once", async () => {
    await guest.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(guestRow.locator('[data-alert="tab_hidden"]')).toHaveText(/Tab in background/, { timeout: 5_000 });
  });

  await test.step("back in front: the alert goes away", async () => {
    await guest.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(guestRow.locator('[data-alert="tab_hidden"]')).toHaveCount(0, { timeout: 5_000 });
  });

  await test.step("the guest's device goes quiet (tab closed): the host sees it stop reporting", async () => {
    await guest.close({ runBeforeUnload: false });
    await expect(guestRow.locator('[data-alert="stale"]')).toBeVisible({ timeout: 30_000 });
  });

  await guestContext.close();
});
