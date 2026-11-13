// A 4K studio: the camera is asked for 4K and recorded at what it delivers (Chromium's fake
// camera offers 3840x2160), the finished file keeps that size, and the combined video stays
// Full HD. The call's copy of the camera is a separate, small one: the recorder's stays 4K.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createStudio, downloadOutputs, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "needs Chromium's 4K fake camera");

const frame = (file: string) =>
  execFileSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]).toString().trim();

test("4K studio: the camera is recorded at 4K and the person's file keeps it", async ({ page: host }) => {
  test.setTimeout(300_000);
  await signInHost(host);
  const { studioUrl } = await createStudio(host, `UHD ${randomBytes(2).toString("hex")}`, { fourK: true });
  await expect(host.getByText(/Up to 4K video · up to/)).toBeVisible();
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 30_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();

  // The camera the page holds is 4K (the recorder's track; the call publishes its own small copy).
  const heights = await host.evaluate(() =>
    [...document.querySelectorAll("video")].flatMap((v) => (v.srcObject as MediaStream | null)?.getVideoTracks().map((t) => t.getSettings().height ?? 0) ?? []),
  );
  expect(Math.max(...heights)).toBe(2160);

  await host.getByRole("button", { name: "Record", exact: true }).click();
  await host.waitForTimeout(6_000);
  await host.getByRole("button", { name: "Stop recording" }).click();
  await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/], { timeout: 120_000 });

  await host.goto(studioUrl);
  await expect(host.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 240_000 });
  const files = await downloadOutputs(host);
  const video = files.find((f) => f.name === "Dev Host - video.mp4")!;
  expect(frame(video.path)).toBe("3840,2160");
  expect(video.duration).toBeGreaterThan(5);
  expect(frame(files.find((f) => f.name === "Combined.mp4")!.path)).toBe("1920,1080");
});
