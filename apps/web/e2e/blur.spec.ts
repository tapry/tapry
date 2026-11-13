// Background blur: a guest turns it on in the green room. Their camera is recorded untouched, a
// small mask track is recorded beside it (and none for the host, who has no blur), and the
// finished video is blurred from that mask. Chromium's fake camera shows no person, so the whole
// frame comes out blurred: the guest's file has far less fine detail than the host's.
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

/** Fine detail in a <video> or <canvas> right now: the mean squared step between neighbouring pixels. */
const detail = (el: Locator) =>
  el.evaluate((node) => {
    const source = node as HTMLVideoElement | HTMLCanvasElement;
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 180;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let energy = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 1; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const step = data[i + 1]! - data[i - 3]!; // green, against the pixel to the left
        energy += step * step;
      }
    }
    return energy / (c.width * c.height);
  });

/**
 * Fine detail in a video file: the mean squared edge strength (Sobel) over its frames. Squared,
 * because blurring an edge spreads it out without making the plain sum any smaller.
 * Sobel at an eighth of its strength: at full strength anything above 255 is cut off, and the
 * fake camera's black-on-white edges reach 1020 (1442 at a corner), which made a sharp edge
 * count for a sixteenth of what it is, no more than the same edge blurred.
 */
function fileDetail(file: string) {
  const { stdout, stderr } = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-hide_banner", "-nostats", "-i", file,
    "-vf", "scale=640:360,format=gray,sobel=scale=0.125,lutyuv=y=val*val/255,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
    "-an", "-f", "null", "-",
  ]);
  const values = [...`${stdout}\n${stderr}`.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  expect(values.length, `detail of ${file}`).toBeGreaterThan(0);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Every track this page registers with the server, and every track it completes. */
function watchTracks(page: Page) {
  const registered: Array<{ trackId: string; kind: string; mimeType: string }> = [];
  const completed = new Set<string>();
  page.on("response", (res) => {
    const req = res.request();
    if (req.method() !== "POST" || !res.ok()) return;
    const path = new URL(req.url()).pathname;
    if (/\/api\/sessions\/[^/]+\/tracks$/.test(path)) {
      const body = req.postDataJSON() as { trackId: string; kind: string; mimeType: string };
      if (!registered.some((t) => t.trackId === body.trackId)) registered.push({ trackId: body.trackId, kind: body.kind, mimeType: body.mimeType });
    }
    const done = /\/api\/sessions\/[^/]+\/tracks\/([^/]+)\/complete$/.exec(path);
    if (done) completed.add(done[1]!);
  });
  return { registered, completed };
}

const filtersButton = (page: Page) => page.getByRole("button", { name: /^Filters/ });
const panel = (page: Page) => page.getByTestId("filters-panel");
const blurStatus = (page: Page) => page.getByTestId("blur-status");

test("background blur: a mask track beside the untouched camera, and a blurred finished file", async ({ page: host, browser }) => {
  const studioName = `E2E Blur ${randomBytes(3).toString("hex")}`;
  await signInHost(host);
  const { studioUrl, inviteUrl } = await createStudio(host, studioName);
  const hostTracks = watchTracks(host);

  await host.getByRole("button", { name: "Enter studio" }).click();
  await expect(host).toHaveURL(/\/session\/ses_/);
  await host.getByRole("button", { name: "Enter the studio" }).click();
  await expect(host.getByTestId("self-tile")).toBeVisible();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const guestTracks = watchTracks(guest);
  // Everything blur needs comes from this server: no request may go anywhere else for it.
  const elsewhere: string[] = [];
  guest.on("request", (req) => {
    const url = new URL(req.url());
    if (/mediapipe|tflite|wasm/.test(url.href) && url.origin !== new URL(inviteUrl).origin) elsewhere.push(url.href);
  });
  await guest.goto(inviteUrl);
  await guest.getByLabel("Your name").fill("Sam Guest");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).click();
  await expect(guest.getByText("Check how you look and sound before you go in.")).toBeVisible();
  await expect.poll(() => guest.locator("video").first().evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);

  let before: Awaited<ReturnType<typeof recorderTracks>> = [];

  await test.step("green room: Blur loads, shows on the preview, and leaves the camera alone", async () => {
    before = await recorderTracks(guest);
    // Wait for a painted frame: on a busy machine the video has a size before it has a picture.
    await expect.poll(() => detail(guest.locator("video").first())).toBeGreaterThan(0);
    const sharp = await detail(guest.locator("video").first());
    expect(sharp).toBeGreaterThan(0);

    await filtersButton(guest).click();
    await expect(panel(guest).getByRole("radio", { name: "Blur" })).not.toBeChecked();
    await panel(guest).getByText("Blur", { exact: true }).click();
    await expect(panel(guest).getByRole("radio", { name: "Blur" })).toBeChecked();
    // The model and its runtime load from this server (headless Chromium may fall back to the processor).
    await expect(blurStatus(guest)).toHaveAttribute("data-blur", "ready", { timeout: 60_000 });
    await expect(blurStatus(guest)).toContainText("finished file");
    expect(elsewhere).toEqual([]);

    // The fake camera shows no person: the whole preview is blurred, the camera's own picture isn't.
    const picture = guest.getByTestId("filtered-picture");
    await expect(picture).toBeVisible();
    await expect.poll(() => detail(picture), { timeout: 15_000 }).toBeLessThan(sharp * 0.5);
    // Waited for: the camera's own element may not have painted a frame yet when the blurred picture already has.
    await expect.poll(() => detail(guest.locator("video").first()), { timeout: 15_000 }).toBeGreaterThan(sharp * 0.7);
    expect(await recorderTracks(guest)).toEqual(before);

    await guest.keyboard.press("Escape");
    expect(await guest.evaluate(() => JSON.parse(localStorage.getItem("tapry:filters")!).filters.background)).toBe("blur");
  });

  await test.step("in the room: blur is ready again before recording, on the same untouched tracks", async () => {
    await guest.getByRole("button", { name: "Join the studio" }).click();
    await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();
    await expect(guest.getByTestId("self-tile").getByTestId("filtered-picture")).toBeVisible();
    await filtersButton(guest).click();
    await expect(blurStatus(guest)).toHaveAttribute("data-blur", "ready", { timeout: 30_000 });
    await guest.keyboard.press("Escape");
    expect(await recorderTracks(guest)).toEqual(before);
  });

  await test.step("recording: the guest records a mask beside audio and video; the host doesn't", async () => {
    await host.getByRole("button", { name: "Record", exact: true }).click();
    await expect(guest.getByText("You're being recorded.")).toBeVisible();
    await expect(guest.getByTestId("local-upload")).toContainText("Recording on this device");
    await host.waitForTimeout(9_000);
    expect(await recorderTracks(guest)).toEqual(before);
    // No alert about the recording because of the mask.
    await expect(guest.getByText(/Recording problem/)).toHaveCount(0);

    await host.getByRole("button", { name: "Stop recording" }).click();
    await expect(host.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 30_000 });
    await expect(guest.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 30_000 });
    expect((await recorderTracks(guest)).map((t) => t.state)).toEqual(["live", "live"]);

    // The mask uploads on its own queue: wait for it to be completed too.
    await expect.poll(() => guestTracks.registered.map((t) => t.kind).sort(), { timeout: 30_000 }).toEqual(["audio", "mask", "video"]);
    const mask = guestTracks.registered.find((t) => t.kind === "mask")!;
    expect(mask.mimeType).toMatch(/^video\/(webm|mp4)/);
    expect(mask.mimeType).not.toMatch(/opus|mp4a/); // picture only
    await expect.poll(() => guestTracks.completed.has(mask.trackId), { timeout: 30_000 }).toBe(true);
    expect(guestTracks.completed.size).toBe(3);
    expect(hostTracks.registered.map((t) => t.kind).sort()).toEqual(["audio", "video"]);
  });

  await test.step("the guest's finished video is blurred; the host's is as sharp as the camera", async () => {
    const studioPage = await host.context().newPage();
    await studioPage.goto(studioUrl);
    const recording = studioPage.getByTestId("recording").first();
    await expect(recording.getByTestId("recording-status")).toHaveText(/Ready/, { timeout: 120_000 });
    await expect(recording.getByTestId("recording-filters")).toContainText("Filters applied");
    // "Filters applied" also shows when a filter fell back: the blur itself must have been applied.
    await expect(recording.getByTestId("filters-failed")).toHaveCount(0);

    const files = await downloadOutputs(studioPage);
    // The mask is never a file anyone downloads.
    expect(files.map((f) => f.name).filter((n) => /mask/i.test(n))).toEqual([]);
    const guestVideo = files.find((f) => f.name === "Sam Guest - video.mp4");
    const hostVideo = files.find((f) => f.name === "Dev Host - video.mp4");
    expect(guestVideo, files.map((f) => f.name).join(", ")).toBeTruthy();
    expect(hostVideo, files.map((f) => f.name).join(", ")).toBeTruthy();
    const guestDetail = fileDetail(guestVideo!.path);
    const hostDetail = fileDetail(hostVideo!.path);
    expect(hostDetail, "host: sharp").toBeGreaterThan(0);
    expect(guestDetail, `guest ${guestDetail} against host ${hostDetail}`).toBeLessThan(hostDetail * 0.5);
    await studioPage.close();
  });

  await guestContext.close();
});
