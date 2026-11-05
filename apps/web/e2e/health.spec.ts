// The admin health page, against the real app: database, storage and the in-process worker.
import { expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "a server page");

test("the admin sees what's working on the server", async ({ page }) => {
  await signInHost(page);
  // Straight there: on a fresh install the admin lands on "Your first studio", which has no sidebar.
  await page.goto("/admin/health");
  await expect(page.getByRole("heading", { name: "Server health" })).toBeVisible();
  const checks = page.getByRole("list", { name: "Checks" });
  for (const id of ["database", "storage", "workers", "queue"]) {
    await expect(checks.locator(`[data-check="${id}"]`), id).toHaveAttribute("data-tone", "ok");
  }
  await expect(page.getByTestId("worker").first()).toContainText("Inside the web server");
  // With a call, the page tests LiveKit from this browser, the way guests reach it.
  if (process.env.LIVEKIT_E2E_URL) await expect(page.getByTestId("call-probe")).toHaveAttribute("data-ok", "true", { timeout: 10_000 });
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("button", { name: "Check again" })).toBeEnabled();
});
