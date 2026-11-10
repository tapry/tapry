// Filters: a guest chooses Black & white. The recorder keeps the untouched camera, the call and
// the guest's own tile show the filtered picture, and the finished file comes out black and white
// while the host's (no filters) keeps its colour.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { createStudio, downloadOutputs, expect, signInHost, test } from "./fixtures";

/** The tracks the recorder uses: the stream in this page's first <video> (green room preview, own tile). */
const recorderTracks = (page: Page) =>
  page.locator("video").first().evaluate((v) =>
    ((v as HTMLVideoElement).srcObject as MediaStream).getTracks().map((t) => ({
      kind: t.kind,
      id: t.id,
      label: t.label,
      state: t.readyState,
      enabled: t.enabled,
      settings: t.getSettings(),
    })),
  );

/** How colourful a <video> or <canvas> is right now: the mean spread between colour channels, 0..255. */
const colourfulness = (el: Locator) =>
  el.evaluate((node) => {
    const source = node as HTMLVideoElement | HTMLCanvasElement;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 36;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let spread = 0;
    for (let i = 0; i < data.length; i += 4) spread += Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
    return spread / (data.length / 4);
  });

/** Average saturation of a video file's frames (ffmpeg signalstats SATAVG; 0 is black and white). */
function saturation(file: string) {
  const { stdout, stderr } = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-hide_banner", "-nostats", "-i", file, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.SATAVG:file=-", "-an", "-f", "null", "-",
  ]);
  const values = [...`${stdout}\n${stderr}`.matchAll(/lavfi\.signalstats\.SATAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  expect(values.length, `saturation of ${file}`).toBeGreaterThan(0);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const filtersButton = (page: Page) => page.getByRole("button", { name: /^Filters/ });
const panel = (page: Page) => page.getByTestId("filters-panel");

test("a guest's filters: live in the call, never in the recorder, applied to the finished file", async ({ page: host, browser }) => {
  const studioName = `E2E Filters ${randomBytes(3).toString("hex")}`;
  await signInHost(host);
  const { studioUrl, inviteUrl } = await createStudio(host, studioName);

  await host.getByRole("button", { name: "Enter studio" }).click();
  await expect(host).toHaveURL(/\/session\/ses_/);
  await host.getByRole("button", { name: "Enter the studio" }).click();
  await expect(host.getByTestId("self-tile")).toBeVisible();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(inviteUrl);
  await guest.getByLabel("Your name").fill("Sam Guest");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).click();
  await expect(guest.getByText("Check how you look and sound before you go in.")).toBeVisible();
  await expect.poll(() => guest.locator("video").first().evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);

  let before: Awaited<ReturnType<typeof recorderTracks>> = [];

  await test.step("green room: Black & white shows on the preview; the camera itself is untouched", async () => {
    before = await recorderTracks(guest);
    expect(before.map((t) => t.kind).sort()).toEqual(["audio", "video"]);
    expect(await colourfulness(guest.locator("video").first())).toBeGreaterThan(15); // the fake camera is colourful

    await expect(guest.getByTestId("filters-on")).toHaveCount(0);
    await filtersButton(guest).click();
    await expect(panel(guest)).toBeVisible();
    await expect(panel(guest).getByText("Your original recording is kept.")).toBeVisible();
    await panel(guest).getByText("Black & white").click();
    await expect(panel(guest).getByRole("radio", { name: "Black & white" })).toBeChecked();
    await expect(guest.getByTestId("filters-on")).toBeVisible();

    // The preview is a canvas over the camera's <video>: grey, while the camera stays in colour.
    const picture = guest.getByTestId("filtered-picture");
    await expect(picture).toBeVisible();
    await expect.poll(() => colourfulness(picture)).toBeLessThan(3);
    expect(await colourfulness(guest.locator("video").first())).toBeGreaterThan(15);
    expect(await recorderTracks(guest)).toEqual(before);

    // Escape closes the panel and gives focus back to the button.
    await guest.keyboard.press("Escape");
    await expect(panel(guest)).toHaveCount(0);
    await expect(filtersButton(guest)).toBeFocused();
    // Remembered on this device.
    expect(await guest.evaluate(() => JSON.parse(localStorage.getItem("opentake:filters")!).filters.look)).toBe("mono");
  });

  await test.step("in the room: the guest's own tile is filtered, and the others see it that way", async () => {
    await guest.getByRole("button", { name: "Join the studio" }).click();
    await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();
    await expect(guest.getByTestId("self-tile").getByTestId("filtered-picture")).toBeVisible();
    await expect.poll(() => colourfulness(guest.getByTestId("self-tile").getByTestId("filtered-picture"))).toBeLessThan(3);
    // The same tracks the green room opened, as they were.
    expect(await recorderTracks(guest)).toEqual(before);

    if (!process.env.LIVEKIT_E2E_URL) {
      test.info().annotations.push({ type: "skipped-step", description: "live picture in the call: no LiveKit server (set LIVEKIT_BIN)" });
      return;
    }
    await expect(guest.getByTestId("call-status")).toHaveText(/Call: connected/, { timeout: 20_000 });
    const guestTile = host.locator('[data-testid="remote-tile"][data-name="Sam Guest"]');
    await expect
      .poll(() => guestTile.locator("video").evaluate((v) => (v as HTMLVideoElement).videoWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);
    // Black and white for the host (a little colour noise from the codec is allowed)...
    await expect.poll(() => colourfulness(guestTile.locator("video")), { timeout: 15_000 }).toBeLessThan(8);
    // ...and still the call's size.
    expect(await guestTile.locator("video").evaluate((v) => (v as HTMLVideoElement).videoHeight)).toBeLessThanOrEqual(360);
    // The host, without filters, is in colour for the guest: the plain copy, as before.
    const hostTile = guest.locator('[data-testid="remote-tile"][data-name="Dev Host"]');
    await expect.poll(() => colourfulness(hostTile.locator("video")), { timeout: 20_000 }).toBeGreaterThan(15);

    // Noise removal in the call never changes the microphone the recorder uses.
    await filtersButton(guest).click();
    await panel(guest).getByRole("switch", { name: "Noise removal" }).click();
    await expect(panel(guest).getByRole("switch", { name: "Noise removal" })).toHaveAttribute("aria-checked", "true");
    await guest.waitForTimeout(1000);
    expect(await recorderTracks(guest)).toEqual(before);
    await panel(guest).getByRole("switch", { name: "Noise removal" }).click();
    await guest.keyboard.press("Escape");
    await expect(panel(guest)).toHaveCount(0);
  });

  await test.step("recording: changing filters meanwhile leaves the recorder alone, and uploads keep going", async () => {
    await host.getByRole("button", { name: "Record", exact: true }).click();
    await expect(guest.getByText("You're being recorded.")).toBeVisible();
    await expect(guest.getByTestId("local-upload")).toContainText("Recording on this device");
    await host.waitForTimeout(3_000);

    // Brighter and back, and the picture back to colour and to black and white again.
    await filtersButton(guest).click();
    await panel(guest).getByText("Brighter").click();
    await panel(guest).getByText("None", { exact: true }).click();
    await expect(guest.getByTestId("filtered-picture")).toBeVisible(); // still brighter
    await panel(guest).getByText("As it is").click();
    await expect(guest.getByTestId("filtered-picture")).toHaveCount(0); // no filters: the plain <video> again
    expect(await recorderTracks(guest)).toEqual(before);
    await panel(guest).getByText("Black & white").click();
    await expect(guest.getByTestId("filtered-picture")).toBeVisible();
    await guest.keyboard.press("Escape");
    expect(await recorderTracks(guest)).toEqual(before);
    await expect(guest.getByTestId("local-upload")).toContainText("Recording on this device");

    await host.waitForTimeout(5_000);
    await host.getByRole("button", { name: "Stop recording" }).click();
    await expect(host.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 30_000 });
    await expect(guest.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 30_000 });
    expect((await recorderTracks(guest)).map((t) => t.state)).toEqual(["live", "live"]);
  });

  await test.step("the guest's finished video is black and white; the host's keeps its colour", async () => {
    const studioPage = await host.context().newPage();
    await studioPage.goto(studioUrl);
    const recording = studioPage.getByTestId("recording").first();
    await expect(recording.getByTestId("recording-status")).toHaveText(/Ready/, { timeout: 120_000 });
    await expect(recording.getByTestId("recording-filters")).toContainText("Filters applied");
    await expect(recording.getByRole("button", { name: "Process again without filters" })).toBeVisible();

    const files = await downloadOutputs(studioPage);
    const guestVideo = files.find((f) => f.name === "Sam Guest - video.mp4");
    const hostVideo = files.find((f) => f.name === "Dev Host - video.mp4");
    expect(guestVideo, files.map((f) => f.name).join(", ")).toBeTruthy();
    expect(hostVideo, files.map((f) => f.name).join(", ")).toBeTruthy();
    const guestSaturation = saturation(guestVideo!.path);
    const hostSaturation = saturation(hostVideo!.path);
    expect(guestSaturation, "guest: black and white").toBeLessThan(2);
    expect(hostSaturation, "host: in colour").toBeGreaterThan(10);
    await studioPage.close();
  });

  await guestContext.close();
});
