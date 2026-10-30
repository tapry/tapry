// Long recording: memory stays flat, uploads keep up, the output covers the whole take.
// Opt-in because it takes as long as it records:  E2E_LONG_MINUTES=10 pnpm test:e2e long.spec.ts
import { randomBytes } from "node:crypto";
import { createStudio, downloadOutputs, expect, signInHost, test } from "./fixtures";

const minutes = Number(process.env.E2E_LONG_MINUTES ?? 0);

test.skip(!minutes, "set E2E_LONG_MINUTES to run");
test.skip(({ browserName }) => browserName !== "chromium", "uses Chromium's performance.memory");

test(`a ${minutes}-minute recording`, async ({ page }) => {
  test.setTimeout((minutes * 60 + 600) * 1000);
  await signInHost(page);
  const { studioUrl } = await createStudio(page, `Long ${minutes} min ${randomBytes(2).toString("hex")}`);
  await page.getByRole("button", { name: "Enter studio" }).click();
  await page.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  const heapMb = () =>
    page.evaluate(() => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 2 ** 20);

  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.waitForTimeout(60_000); // warmed up: recorders, call, first uploads
  const heapAtStart = await heapMb();
  const samples: Array<{ minute: number; heap: number; status: string }> = [];
  for (let m = 2; m <= minutes; m++) {
    await page.waitForTimeout(60_000);
    const status = (await page.getByTestId("local-upload").textContent()) ?? "";
    samples.push({ minute: m, heap: await heapMb(), status });
    // Uploads keep up: the status never says the upload has fallen behind.
    expect(status, `minute ${m}`).not.toContain("behind");
  }
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 300_000 });

  const heapAtEnd = samples.at(-1)?.heap ?? heapAtStart;
  console.log(`[long] heap MB at 1 min ${heapAtStart.toFixed(1)}, at ${minutes} min ${heapAtEnd.toFixed(1)}`, samples);
  // Chunks live on disk, not in memory: the heap must not grow with the recording's length.
  expect(heapAtEnd - heapAtStart).toBeLessThan(50);

  await page.goto(studioUrl);
  await expect(page.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: (minutes * 60 + 300) * 1000 });
  const files = await downloadOutputs(page);
  for (const f of files) expect(f.duration, f.name).toBeGreaterThan(minutes * 60 - 2);
  const durations = files.map((f) => f.duration);
  expect(Math.max(...durations) - Math.min(...durations)).toBeLessThan(0.1);
});
