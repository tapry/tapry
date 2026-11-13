// The free upload-speed check: the page in the app, and the public endpoint called from another
// site (the project website) the way browsers really do it, preflight included.
import { expect, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "the same page in every engine");

test("the upload-speed check says which kinds of studio the line keeps up with", async ({ page }) => {
  await page.goto("/tools/upload-speed");
  await page.getByRole("button", { name: "Test my upload" }).click();
  await expect(page.getByTestId("upload-mbps")).toHaveText(/^\d+(\.\d)?$/, { timeout: 30_000 });
  // On this machine the line is fast: everything keeps up.
  await expect(page.locator("[data-verdict]")).toHaveCount(4);
  await expect(page.locator('[data-verdict="ok"]')).toHaveCount(4);
});

test("the project website may use the public speed test; other sites may not", async ({ page, baseURL }) => {
  const endpoint = new URL("/api/speed-test", baseURL).href;
  const fromSite = async (origin: string) => {
    // Here the app runs on localhost; Chrome asks before a public page reaches a local address
    // (Local Network Access). In production both are public, so there is nothing to ask.
    await page.context().grantPermissions(["local-network-access"], { origin });
    await page.route(`${origin}/`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>site</title>" }));
    await page.goto(`${origin}/`);
    return page.evaluate(async (url) => {
      try {
        const res = await fetch(url, { method: "POST", body: new Uint8Array(256 * 1024) });
        return { status: res.status, body: await res.json() };
      } catch {
        return { blocked: true };
      }
    }, endpoint);
  };
  expect(await fromSite("https://tapry.test")).toEqual({ status: 200, body: { bytes: 256 * 1024 } });
  expect(await fromSite("https://elsewhere.test")).toEqual({ blocked: true });
});
