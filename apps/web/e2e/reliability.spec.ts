// "Never lose a recording" under bad conditions (Chromium only: uses DevTools protocol controls).
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { createStudio, downloadOutputs, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "needs Chromium's DevTools protocol");

async function enterRoom(page: Page) {
  await page.getByRole("button", { name: "Enter studio" }).click();
  await page.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
}

async function expectProcessed(page: Page, studioUrl: string, seconds: number) {
  await page.goto(studioUrl);
  await expect(page.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 150_000 });
  const files = await downloadOutputs(page);
  // One file per kind for the host even if their tab died and came back: pieces are merged.
  expect(files.map((f) => f.name)).toEqual(["Combined.mp4", "Dev Host - audio.wav", "Dev Host - video.mp4"]);
  const durations = files.map((f) => f.duration);
  expect(Math.max(...durations) - Math.min(...durations)).toBeLessThan(0.1);
  expect(durations[0]).toBeGreaterThan(seconds - 1);
  return files;
}

test("slow, lossy uplink: everything still arrives", async ({ page }) => {
  await signInHost(page);
  const { studioUrl } = await createStudio(page, `Lossy ${randomBytes(2).toString("hex")}`);
  await enterRoom(page);

  // A slow uplink (1 Mbit/s, 200 ms) ...
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 200,
    downloadThroughput: (5 * 1024 * 1024) / 8,
    uploadThroughput: (1 * 1024 * 1024) / 8,
  });
  // ... where 30% of every upload step fails: signing, the storage PUT, the commit.
  let seed = 42;
  const flaky = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) < 0.3;
  let failed = 0;
  let passed = 0;
  const appOrigin = new URL(page.url()).origin;
  await page.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const uploadStep =
      (url.origin === appOrigin && /\/chunks\/\d+\/(upload-url|commit)$/.test(url.pathname)) ||
      (url.origin !== appOrigin && req.method() === "PUT"); // the PUT to signed storage
    if (!uploadStep) return route.fallback();
    if (flaky()) {
      failed++;
      return route.abort("connectionreset");
    }
    passed++;
    return route.continue();
  });

  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.waitForTimeout(15_000);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 150_000 });

  expect(failed, "the chaos really happened").toBeGreaterThan(5);
  expect(passed).toBeGreaterThan(failed);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await expectProcessed(page, studioUrl, 15);
});

// The tab is killed without warning (no beforeunload, nothing flushed). A real renderer crash
// (DevTools Page.crash) hangs Playwright with this Chromium build, so an abrupt close stands in.
test("tab dies mid-recording while offline: leftovers upload after rejoining, pieces merged", async ({ page, context }) => {
  await signInHost(page);
  const { studioUrl } = await createStudio(page, `Crash ${randomBytes(2).toString("hex")}`);
  await enterRoom(page);
  const sessionUrl = page.url();

  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.waitForTimeout(3_000);
  // Offline: chunks now only exist in this tab's IndexedDB...
  await context.setOffline(true);
  await page.waitForTimeout(6_000);
  // ... and then the tab is gone.
  await page.close({ runBeforeUnload: false });

  // Back online, the host reopens the session and rejoins; the recording is still running.
  await context.setOffline(false);
  const again = await context.newPage();
  await again.goto(sessionUrl);
  await again.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(again.getByText(/REC \d\d:\d\d/)).toBeVisible();
  await again.waitForTimeout(4_000);
  await again.getByRole("button", { name: "Stop recording" }).click();
  await expect(again.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 120_000 });

  // The crashed tab's chunks (recorded offline) made it: the merged files cover the whole take.
  await expectProcessed(again, studioUrl, 13);
});
