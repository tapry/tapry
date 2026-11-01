// Live call across engines: the host in this project's browser (Chromium, Firefox or WebKit),
// a guest in Chromium, and in Firefox and WebKit also a guest in the other one (so two
// non-Chromium browsers talk to each other). Checks both directions — this browser sending camera and sound, and
// receiving them — plus mute, and that joining the call leaves the recorded tracks untouched.
// Needs LiveKit: `LIVEKIT_BIN=… pnpm test:e2e e2e/call.spec.ts --project firefox --project webkit`.
import { randomBytes } from "node:crypto";
import { chromium, firefox, webkit, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";
import { browserLabel, createStudio, expect, signInHost, test } from "./fixtures";

test.skip(!process.env.LIVEKIT_E2E_URL, "needs a LiveKit server (set LIVEKIT_BIN)");

const tile = (page: Page, name: string) => page.locator(`[data-testid="remote-tile"][data-name="${name}"]`);

/** True when the video shows real frames and keeps advancing for a second. */
const videoPlaying = (video: Locator) =>
  video.evaluate(async (el) => {
    const v = el as HTMLVideoElement;
    const start = v.currentTime;
    await new Promise((r) => setTimeout(r, 1000));
    return v.videoWidth > 0 && !v.paused && v.currentTime > start;
  });

/**
 * What actually arrives through a remote participant's <audio>: whether it plays, and the
 * loudest sample over 3 s (dBFS, null for silence). Measured from the received stream itself.
 */
const receivedAudio = (audio: Locator) =>
  audio.evaluate(async (el) => {
    const a = el as HTMLAudioElement;
    const ctx = new AudioContext();
    await ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(a.srcObject as MediaStream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    for (const end = performance.now() + 3000; performance.now() < end; ) {
      analyser.getFloatTimeDomainData(buf);
      for (const x of buf) peak = Math.max(peak, Math.abs(x));
      await new Promise((r) => setTimeout(r, 40));
    }
    await ctx.close();
    return { playing: !a.paused, peakDb: peak > 0 ? 20 * Math.log10(peak) : null };
  });

type Engine = "chromium" | "firefox" | "webkit";

/** A guest browser of the given engine with fake camera and mic, and silent speakers. */
async function launchGuest(engine: Engine): Promise<{ browser: Browser; page: Page }> {
  let browser: Browser;
  if (engine === "chromium") {
    browser = await chromium.launch({
      channel: "chromium",
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--mute-audio"],
    });
  } else if (engine === "firefox") {
    browser = await firefox.launch({
      // Same prefs as the firefox project in playwright.config.ts.
      firefoxUserPrefs: {
        "media.navigator.streams.fake": true,
        "media.navigator.permission.disabled": true,
        "media.volume_scale": "0.0",
      },
    });
  } else {
    browser = await webkit.launch();
  }
  // Playwright applies the config's default permissions here too; Firefox takes them from prefs.
  const context = await browser.newContext({ permissions: engine === "firefox" ? [] : ["camera", "microphone"] });
  // WebKit has no mute switch (see fixtures.ts).
  await context.addInitScript(() => {
    document.addEventListener("play", (e) => ((e.target as HTMLMediaElement).muted = true), true);
  });
  return { browser, page: await context.newPage() };
}

const engineName = (e: Engine) => ({ chromium: "Chromium", firefox: "Firefox", webkit: "WebKit" })[e];

/** The local camera track's height (what the recorder records), read from the self view. */
const ownCameraHeight = (page: Page) =>
  page.getByTestId("self-tile").locator("video").evaluate((v) => {
    const track = ((v as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]!;
    return { height: track.getSettings().height ?? 0, state: track.readyState, enabled: track.enabled };
  });

test("live call with a Chromium guest: both see and hear each other", async ({ page }, testInfo) => {
  await callTest(page, testInfo, "chromium");
});

test("live call between two non-Chromium browsers", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "firefox" && project !== "webkit", "the Firefox and WebKit projects host this one");
  await callTest(page, testInfo, project === "firefox" ? "webkit" : "firefox");
});

async function callTest(host: Page, testInfo: TestInfo, guestEngine: Engine) {
  const engine = browserLabel(testInfo.project.name);
  const guestName = `${engineName(guestEngine)} Guest`;
  if (process.env.CALL_DEBUG) host.on("console", (m) => console.log(`[host ${m.type()}]`, m.text().slice(0, 300)));
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `Call ${engine} ${randomBytes(2).toString("hex")}`);

  await test.step(`host enters the studio in ${engine}`, async () => {
    await host.getByRole("button", { name: "Enter studio" }).click();
    await expect.poll(() => host.locator("video").first().evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    await host.getByRole("button", { name: "Enter the studio" }).click();
    await expect(host.getByText("Connected", { exact: true })).toBeVisible();
  });
  const recordedBefore = await ownCameraHeight(host);

  const { browser: guestBrowser, page: guest } = await launchGuest(guestEngine);
  if (process.env.CALL_DEBUG) guest.on("console", (m) => console.log(`[guest ${m.type()}]`, m.text().slice(0, 300)));

  try {
    await test.step(`a guest joins from ${engineName(guestEngine)} with camera and mic`, async () => {
      await guest.goto(inviteUrl);
      await guest.getByLabel("Your name").fill(guestName);
      await guest.getByRole("checkbox").check();
      await guest.getByRole("button", { name: "Continue" }).click();
      await guest.getByRole("button", { name: "Join the studio" }).click();
      await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();
    });

    await test.step("both are connected to the call", async () => {
      await expect(host.getByTestId("call-status")).toHaveText(/Call: connected/, { timeout: 30_000 });
      await expect(guest.getByTestId("call-status")).toHaveText(/Call: connected/, { timeout: 30_000 });
      // If this browser blocks autoplay, the room offers a button: press it like a person would.
      const enableAudio = host.getByRole("button", { name: "Click to hear the others" });
      // It can also go away by itself as playback starts; the next step checks the sound arrives.
      if (await enableAudio.isVisible().catch(() => false)) await enableAudio.click({ timeout: 3_000 }).catch(() => {});
    });

    await test.step(`${engine} receives: the guest's camera plays and their sound arrives`, async () => {
      const guestTile = tile(host, guestName);
      await expect(guestTile.locator("video")).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => videoPlaying(guestTile.locator("video")), { timeout: 30_000 }).toBe(true);
      await expect(guestTile.locator("audio")).toHaveCount(1, { timeout: 30_000 });
      const audio = await receivedAudio(guestTile.locator("audio"));
      expect(audio.playing, "audio element playing").toBe(true);
      expect(audio.peakDb, "guest's sound reaches the host").toBeGreaterThan(-50);
    });

    await test.step(`${engine} sends: the guest sees the host's camera and hears them`, async () => {
      const hostTile = tile(guest, "Dev Host");
      await expect(hostTile.locator("video")).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => videoPlaying(hostTile.locator("video")), { timeout: 30_000 }).toBe(true);
      // The call gets a scaled-down copy.
      expect(await hostTile.locator("video").evaluate((v) => (v as HTMLVideoElement).videoHeight)).toBeLessThanOrEqual(360);
      const audio = await receivedAudio(hostTile.locator("audio"));
      expect(audio.playing, "audio element playing").toBe(true);
      expect(audio.peakDb, "host's sound reaches the guest").toBeGreaterThan(-50);
    });

    await test.step("mute in this browser silences the call and the recorded track", async () => {
      await host.getByRole("button", { name: "Mute" }).click();
      await expect(tile(guest, "Dev Host")).toHaveAttribute("data-mic", "muted");
      expect(
        await host.getByTestId("self-tile").locator("video").evaluate((v) =>
          ((v as HTMLVideoElement).srcObject as MediaStream).getAudioTracks()[0]!.enabled),
      ).toBe(false);
      await host.getByRole("button", { name: "Unmute" }).click();
      await expect(tile(guest, "Dev Host")).toHaveAttribute("data-mic", "on");
    });

    await test.step("the call never touched the camera track being recorded", async () => {
      const after = await ownCameraHeight(host);
      expect(after).toEqual({ ...recordedBefore, enabled: true });
      expect(after.state).toBe("live");
    });
  } finally {
    await guestBrowser.close();
  }
}

// Regression: after a failed attempt both the error path and the room's Disconnected event
// scheduled a retry, so the same person joined twice, LiveKit kicked the older copy, and the
// copies kept kicking each other out. Here every attempt fails (relay-only, and the test
// LiveKit has no TURN): retries must stay one at a time, backing off.
test("a call that can't connect retries one attempt at a time", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "connection logic is the same in every engine");
  await signInHost(page);
  await createStudio(page, `Retry ${randomBytes(2).toString("hex")}`);
  await page.getByRole("button", { name: "Enter studio" }).click();
  await expect(page).toHaveURL(/\/session\//);
  await page.goto(`${page.url()}?relay=1`);
  let tokenRequests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/call-token")) tokenRequests++;
  });
  await page.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await page.waitForTimeout(25_000);
  await expect(page.getByTestId("call-status")).not.toHaveText(/connected/);
  // One chain with backoff (1, 2, 4, 8 s...) makes about 5 attempts in 25 s; parallel chains
  // that double on every failure make many more.
  console.log(`call-token requests in 25 s: ${tokenRequests}`);
  expect(tokenRequests).toBeGreaterThanOrEqual(2);
  expect(tokenRequests).toBeLessThanOrEqual(7);
});
