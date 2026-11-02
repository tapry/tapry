// The admin health page, against the real app: database, storage and the in-process worker.
import { expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "a server page");

test("the admin sees what's working on the server", async ({ page }) => {
  await signInHost(page);
  await page.getByRole("link", { name: "Server health →" }).click();
  await expect(page.getByRole("heading", { name: "Server health" })).toBeVisible();
  const checks = page.getByRole("list", { name: "Checks" });
  for (const id of ["database", "storage", "workers", "queue"]) {
    await expect(checks.locator(`[data-check="${id}"]`), id).toHaveAttribute("data-tone", "ok");
  }
  await expect(page.getByTestId("worker").first()).toContainText("Inside the web server");
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("button", { name: "Check again" })).toBeEnabled();
});
