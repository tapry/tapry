// Sharing a screen: the guest sees it in the call, it is recorded on the sharer's device while
// the recording runs (picture only, a track of its own), and it becomes "<name> - screen.mp4",
// black from the moment sharing stopped.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createStudio, downloadOutputs, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "screen capture is automated in Chromium only");

const ffprobe = (args: string[]) => execFileSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", ...args]).toString().trim();
const light = (file: string, t: number) =>
  Number(
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-hide_banner", "-ss", String(t), "-i", file, "-frames:v", "1",
      "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString().match(/YAVG=([\d.]+)/)![1]!,
  );

test("a shared screen: seen by the guest, recorded on the host's device, a file of its own", async ({ page: host, browser }) => {
  test.setTimeout(300_000);
  await signInHost(host);
  const { studioUrl, inviteUrl } = await createStudio(host, `Screen ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 30_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(inviteUrl);
  await guest.getByLabel("Your name").fill("Sam Guest");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.getByRole("button", { name: "Join the studio" }).click({ timeout: 30_000 });
  await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();

  // Share before Record: the guest sees it; nothing of it is recorded yet.
  await host.getByRole("button", { name: "Share your screen" }).click();
  await expect(host.getByTestId("screen-tile")).toContainText("You're sharing your screen");
  const seen = guest.getByTestId("screen-tile");
  await expect(seen).toHaveAttribute("data-name", "Dev Host's screen", { timeout: 30_000 });
  await expect.poll(() => seen.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  // While the host shares, the guest can't start a second one.
  await expect(guest.getByRole("button", { name: "Share your screen" })).toBeDisabled();

  await host.getByRole("button", { name: "Record", exact: true }).click();
  await host.waitForTimeout(5_000);
  await host.getByRole("button", { name: "Stop sharing your screen" }).click();
  await expect(guest.getByTestId("screen-tile")).toHaveCount(0);
  await host.waitForTimeout(4_000);
  await host.getByRole("button", { name: "Stop recording" }).click();
  await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/, /✓ Uploaded/], { timeout: 120_000 });

  await host.goto(studioUrl);
  await expect(host.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 240_000 });
  const files = await downloadOutputs(host);
  expect(files.map((f) => f.name)).toContain("Dev Host - screen.mp4");
  expect(files.map((f) => f.name)).not.toContain("Sam Guest - screen.mp4");
  const screen = files.find((f) => f.name === "Dev Host - screen.mp4")!;
  expect(ffprobe(["-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", screen.path])).toBe("1920,1080");
  expect(ffprobe(["-show_entries", "stream=codec_type", "-of", "csv=p=0", screen.path])).toBe("video"); // picture only
  // As long as the recording, like every file; the screen at the start, black once sharing had stopped.
  const video = files.find((f) => f.name === "Dev Host - video.mp4")!;
  expect(Math.abs(screen.duration - video.duration)).toBeLessThan(0.2);
  const [during, after] = [light(screen.path, 2), light(screen.path, screen.duration - 1)];
  expect(after).toBeCloseTo(16, 0); // video black
  expect(Math.abs(during - after)).toBeGreaterThan(1); // the test browser's screen is dark, but it isn't that black
  await guestContext.close();
});
