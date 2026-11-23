// A filter first switched on while the recording is already running is in that person's
// finished file from that moment: before it the file is as recorded, like the call was.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { createStudio, downloadOutputs, expect, signInHost, test } from "./fixtures";

/** Average saturation of a video file's frames between two times (ffmpeg signalstats SATAVG; a black and white picture reads about 1). */
function saturation(file: string, fromS: number, toS: number) {
  const { stdout, stderr } = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-hide_banner", "-nostats", "-ss", String(fromS), "-t", String(toS - fromS), "-i", file, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.SATAVG:file=-", "-an", "-f", "null", "-",
  ]);
  const values = [...`${stdout}\n${stderr}`.matchAll(/lavfi\.signalstats\.SATAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  expect(values.length, `saturation of ${file}`).toBeGreaterThan(0);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const filtersButton = (page: Page) => page.getByRole("button", { name: /^Filters/ });
const panel = (page: Page) => page.getByTestId("filters-panel");

test("a filter switched on during the recording is in the finished file from that moment", async ({ page: host }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium" && !process.env.E2E_ALL, "a request and a render, the same everywhere");
  test.setTimeout(240_000);
  await signInHost(host);
  const { studioUrl } = await createStudio(host, `E2E Late filter ${randomBytes(3).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click();
  await expect(host.getByTestId("self-tile")).toBeVisible();

  const sent: Array<{ status: number; body: string | null }> = [];
  host.on("response", (res) => {
    if (/\/api\/sessions\/[^/]+\/filters$/.test(new URL(res.url()).pathname)) sent.push({ status: res.status(), body: res.request().postData() });
  });

  await host.getByRole("button", { name: "Record", exact: true }).click();
  await expect(host.getByTestId("local-upload")).toContainText("Recording on this device");
  await host.waitForTimeout(5_000);

  await filtersButton(host).click();
  await panel(host).getByText("Black & white").click();
  await host.keyboard.press("Escape");
  await expect.poll(() => sent.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(sent.at(-1)!.status).toBe(200);
  const change = JSON.parse(sent.at(-1)!.body!);
  expect(change.filters.look).toBe("mono");
  // It says when the choice was made, on the server's clock.
  expect(Math.abs(change.at - Date.now())).toBeLessThan(5_000);

  await host.waitForTimeout(6_000);
  await host.getByRole("button", { name: "Stop recording" }).click();
  await expect(host.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 30_000 });

  const studioPage = await host.context().newPage();
  await studioPage.goto(studioUrl);
  const recording = studioPage.getByTestId("recording").first();
  await expect(recording.getByTestId("recording-status")).toHaveText(/Ready/, { timeout: 120_000 });
  await expect(recording.getByTestId("recording-filters")).toContainText("Filters applied");
  const files = await downloadOutputs(studioPage);
  const video = files.find((f) => f.name === "Dev Host - video.mp4");
  expect(video, files.map((f) => f.name).join(", ")).toBeTruthy();
  // In colour until the switch (about 5 s in), black and white from there to the end.
  expect(saturation(video!.path, 0.5, 3), "before: as recorded").toBeGreaterThan(10);
  expect(saturation(video!.path, 8, 10), "after: black and white").toBeLessThan(2);
});
