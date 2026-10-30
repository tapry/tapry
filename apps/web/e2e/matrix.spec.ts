// Browser matrix: does recording work end to end in each engine, with the format it really uses?
// Runs in every project (chromium, firefox, webkit, webkit-mp4); see playwright.config.ts.
import { randomBytes } from "node:crypto";
import {
  browserLabel,
  createStudio,
  downloadOutputs,
  expect,
  recordedMimeTypes,
  signInHost,
  test,
} from "./fixtures";

/** What each project should record with. Safari before 18.4 and iOS only have MP4. */
const EXPECTED_FORMAT: Record<string, RegExp> = {
  chromium: /^video\/webm;codecs=vp9,opus$/,
  firefox: /^video\/webm;codecs=vp8,opus$/, // Firefox has no VP9 in MediaRecorder
  webkit: /^video\/webm/,
  "webkit-mp4": /^video\/mp4/,
};

test("records, uploads and processes in this browser", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await signInHost(page);
  const { studioUrl } = await createStudio(page, `Matrix ${browserLabel(project)} ${randomBytes(2).toString("hex")}`);

  await test.step("green room: camera and mic work", async () => {
    await page.getByRole("button", { name: "Enter studio" }).click();
    await expect.poll(() => page.locator("video").first().evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    await page.getByRole("heading").first().click(); // user gesture for the audio meter
    await expect
      .poll(async () => Number(await page.getByRole("meter", { name: "Microphone level" }).getAttribute("aria-valuenow")), {
        timeout: 15_000,
      })
      .toBeGreaterThan(-60);
    await page.getByRole("button", { name: "Enter the studio" }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  });

  await test.step("record 8 seconds in the browser's own format", async () => {
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await expect(page.getByText(/REC 00:0\d/)).toBeVisible();
    await page.waitForTimeout(8_000);
    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(page.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 60_000 });

    const formats = await recordedMimeTypes(page);
    // One audio-only recorder and one camera recorder.
    expect(formats.filter((f) => f.startsWith("audio/"))).toHaveLength(1);
    expect(formats.filter((f) => f.startsWith("video/"))).toEqual([expect.stringMatching(EXPECTED_FORMAT[project]!)]);
  });

  await test.step("processing turns it into aligned WAV + MP4", async () => {
    await page.goto(studioUrl);
    await expect(page.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 120_000 });
    const files = await downloadOutputs(page);
    expect(files.map((f) => f.name)).toEqual(["Combined.mp4", "Dev Host - audio.wav", "Dev Host - video.mp4"]);
    for (const f of files) {
      if (f.name.endsWith(".wav")) expect(f.body.subarray(0, 4).toString()).toBe("RIFF");
      else expect(f.body.subarray(4, 8).toString()).toBe("ftyp");
    }
    const durations = files.map((f) => f.duration);
    expect(Math.max(...durations) - Math.min(...durations)).toBeLessThan(0.1);
    expect(durations[0]).toBeGreaterThan(7);
  });
});
