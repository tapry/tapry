// An audio-only show: nobody is asked for a camera, the call and the recording are sound only,
// and the episode's files are audio only, everyone mixed included (here as FLAC), with no video.
import { randomBytes } from "node:crypto";
import { createStudio, downloadOutputs, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "the same in every engine");

test("audio-only show: no cameras anywhere, FLAC files and a mix at the end", async ({ page: host, browser }) => {
  await signInHost(host);
  const { studioUrl, inviteUrl } = await createStudio(host, `Audio ${randomBytes(2).toString("hex")}`, { audioOnly: true });
  await expect(host.getByText(/Audio only · up to/)).toBeVisible();
  // And FLAC files, from Settings.
  await host.getByRole("tab", { name: "Settings" }).click();
  await host.getByLabel("Audio files").selectOption("flac");
  await host.getByRole("button", { name: "Save changes" }).click();
  await expect(host.getByText("✓ Saved")).toBeVisible();
  await host.getByRole("tab", { name: "Episodes" }).click();
  await host.getByRole("button", { name: "Enter studio" }).click();
  await expect(host.getByText("This show is sound only")).toBeVisible();
  await expect(host.getByLabel("Camera")).toHaveCount(0);
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();
  await expect(host.getByRole("button", { name: "Turn camera off" })).toHaveCount(0);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(inviteUrl);
  await expect(guest.getByText("My microphone is recorded")).toBeVisible();
  await guest.getByLabel("Your name").fill("Sam Guest");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).click();
  await expect(guest.getByText("This show is sound only")).toBeVisible();
  await guest.getByRole("button", { name: "Join the studio" }).click();
  await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();
  // Nobody's camera was opened.
  expect(await guest.evaluate(() => [...document.querySelectorAll("video")].some((v) => (v.srcObject as MediaStream | null)?.getVideoTracks().length))).toBe(false);

  await host.getByRole("button", { name: "Record", exact: true }).click();
  await host.waitForTimeout(4_000);
  await host.getByRole("button", { name: "Stop recording" }).click();
  await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/, /✓ Uploaded/], { timeout: 60_000 });

  await host.goto(studioUrl);
  await expect(host.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 120_000 });
  await expect(host.getByText("Everyone, mixed")).toBeVisible();
  const files = await downloadOutputs(host);
  expect(files.map((f) => f.name)).toEqual(["Combined.flac", "Dev Host - audio.flac", "Sam Guest - audio.flac"]);
  for (const f of files) {
    expect(f.body.subarray(0, 4).toString(), f.name).toBe("fLaC");
    expect(f.duration, f.name).toBeGreaterThan(3);
  }
  await guestContext.close();
});
