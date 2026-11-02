// Full host + guest flow in real Chromium with fake camera and mic (see playwright.config.ts).
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";
import { createStudio, expect, fileNames, mediaLinks, signInHost, test } from "./fixtures";

// The storage the test server writes to (started by scripts/with-seaweedfs.mjs).
const s3 = new S3Client({
  endpoint: process.env.S3_E2E_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_E2E_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_E2E_SECRET_ACCESS_KEY ?? "",
  },
});
const BUCKET = process.env.S3_E2E_BUCKET ?? "tapry-e2e";
/** Direct storage access for extra checks; absent when testing a deployed stack via E2E_BASE_URL. */
const canReadStorage = !!process.env.S3_E2E_ENDPOINT;

async function listChunks(sessionId: string) {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `recordings/${sessionId}/`, ContinuationToken: token }),
    );
    keys.push(...(page.Contents ?? []).map((o) => o.Key!));
    token = page.NextContinuationToken;
  } while (token);
  return keys;
}

/** Integrated loudness (LUFS) and true peak (dBTP) of a file, via ffmpeg's EBU R128 meter. */
function loudness(file: string) {
  // The meter reports on stderr.
  const { stderr } = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-",
  ]);
  const report = stderr.toString();
  return {
    integrated: Number.parseFloat(/I:\s+(-?[\d.]+) LUFS/.exec(report.slice(report.lastIndexOf("Summary")))?.[1] ?? "NaN"),
    truePeak: Number.parseFloat(/True peak:\s+Peak:\s+(-?[\d.]+) dBFS/.exec(report)?.[1] ?? "NaN"),
  };
}

/** Duration in seconds of a downloaded file, via ffprobe. */
function probeDuration(file: string) {
  const out = execFileSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number.parseFloat(out.toString());
}

async function readObject(key: string) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

// Fixed, because Playwright re-evaluates this file for each repeat while the server (and its
// admin account) lives for the whole run. The database is a fresh temp dir per run.

/** The <video> element's live stream, inspected in the page. */
const streamInfo = (page: Page) =>
  page.locator("video").first().evaluate((v) => {
    const s = (v as HTMLVideoElement).srcObject as MediaStream | null;
    return {
      width: (v as HTMLVideoElement).videoWidth,
      audio: s?.getAudioTracks().map((t) => ({ state: t.readyState, settings: t.getSettings() })) ?? [],
      video: s?.getVideoTracks().map((t) => ({ state: t.readyState, settings: t.getSettings() })) ?? [],
    };
  });

const meterValue = async (page: Page) =>
  Number(await page.getByRole("meter", { name: "Microphone level" }).getAttribute("aria-valuenow"));

async function expectWorkingGreenRoom(page: Page) {
  await expect(page.getByText("Check how you look and sound before you go in.")).toBeVisible();
  // Camera: the fake device's test pattern is playing at the studio's 1080p setting.
  await expect.poll(async () => (await streamInfo(page)).width).toBeGreaterThan(0);
  const { video } = await streamInfo(page);
  expect(video[0]?.settings.height).toBe(1080);
  // Mic: the meter is driven by the fake mic's beeps. A click satisfies the autoplay policy.
  await page.getByRole("heading").first().click();
  await expect.poll(() => meterValue(page), { timeout: 15_000 }).toBeGreaterThan(-60);
  await expect(page.getByText(/Recording supported \(video\/webm\)/)).toBeVisible();
  await expect(page.getByText(/Connection OK \(\d+ ms\)/)).toBeVisible();
}

test("host and guest: green room, join, Record/Stop, end session", async ({ page: host, browser }) => {
  let inviteUrl = "";
  let studioUrl = "";

  const studioName = `E2E Show ${randomBytes(3).toString("hex")}`;

  await test.step("host creates the admin account (or logs in to it) and a show", async () => {
    // The first run on a fresh server creates the admin; repeats log in (sign-up is closed by then).
    await signInHost(host);
    ({ studioUrl, inviteUrl } = await createStudio(host, studioName));
    await expect(host).toHaveTitle(new RegExp(studioName));
    expect(inviteUrl).toMatch(/\/join\/[\w-]{22}$/);
  });

  await test.step("guest who comes too early is told to wait", async () => {
    const early = await browser.newContext();
    const page = await early.newPage();
    await page.goto(inviteUrl);
    await page.getByLabel("Your name").fill("Too Early");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(/hasn't opened the studio yet/)).toBeVisible();
    await early.close();
  });

  await test.step("host's green room shows camera, mic level and checks", async () => {
    await host.getByRole("button", { name: "Enter studio" }).click();
    await expect(host).toHaveURL(/\/session\/ses_/);
    await expectWorkingGreenRoom(host);
  });

  await test.step("ticking headphones really turns off echo cancellation on the mic", async () => {
    expect((await streamInfo(host)).audio[0]?.settings.echoCancellation).toBe(true);
    await host.getByLabel("I'm wearing headphones").check();
    await expect.poll(async () => (await streamInfo(host)).audio[0]?.settings.echoCancellation).toBe(false);
    expect((await streamInfo(host)).audio[0]?.settings.autoGainControl).toBe(false);
  });

  await test.step("host enters the room and the camera survives the hand-off", async () => {
    await host.getByRole("button", { name: "Enter the studio" }).click();
    await expect(host.getByText("Connected", { exact: true })).toBeVisible();
    await expect(host.getByTestId("self-tile")).toHaveAttribute("data-name", "Dev Host (you)");
    // The green room must not stop the stream it handed over (and React dev mode must not either).
    await host.waitForTimeout(500);
    const info = await streamInfo(host);
    expect(info.video.map((t) => t.state)).toEqual(["live"]);
    expect(info.audio.map((t) => t.state)).toEqual(["live"]);
  });

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();

  await test.step("guest joins with consent and goes through the green room audio-only", async () => {
    await guest.goto(inviteUrl);
    await guest.getByLabel("Your name").fill("Sam Guest");
    await guest.getByRole("button", { name: "Continue" }).click();
    // Consent is required: nothing happens without it.
    await expect(guest).toHaveURL(inviteUrl);
    await guest.getByRole("checkbox").check();
    await guest.getByRole("button", { name: "Continue" }).click();

    await expectWorkingGreenRoom(guest);
    await guest.getByLabel("Camera").selectOption("off");
    await expect(guest.getByText(/^Camera off\./)).toBeVisible();
    await expect.poll(async () => (await streamInfo(guest)).video.length).toBe(0);
    await expect.poll(() => meterValue(guest), { timeout: 15_000 }).toBeGreaterThan(-60);

    await guest.getByRole("button", { name: "Join the studio" }).click();
    await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();
  });

  await test.step("host sees the guest arrive, live", async () => {
    await expect(host.getByText("Sam Guest").first()).toBeVisible();
  });

  await test.step("live call: both see and hear each other; the recording keeps full quality", async () => {
    // Without LiveKit only this step is skipped (test.skip would skip the whole flow).
    if (!process.env.LIVEKIT_E2E_URL) {
      test.info().annotations.push({ type: "skipped-step", description: "live call: no LiveKit server (set LIVEKIT_BIN)" });
      await expect(host.getByTestId("call-status")).toHaveCount(0); // call is off, room still works
      return;
    }
    await expect(host.getByTestId("call-status")).toHaveText(/Call: connected/, { timeout: 20_000 });
    await expect(guest.getByTestId("call-status")).toHaveText(/Call: connected/, { timeout: 20_000 });

    // The guest sees the host's camera, actually playing.
    const hostTile = guest.locator('[data-testid="remote-tile"][data-name="Dev Host"]');
    await expect(hostTile).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => hostTile.locator("video").evaluate((v) => (v as HTMLVideoElement).videoWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);
    // The call gets a scaled-down copy...
    expect(await hostTile.locator("video").evaluate((v) => (v as HTMLVideoElement).videoHeight)).toBeLessThanOrEqual(360);
    // ...while the host's own camera track, the one being recorded, stays at full resolution.
    expect((await streamInfo(host)).video[0]?.settings.height).toBe(1080);

    // The host gets the audio-only guest as a tile with a live mic.
    const guestTile = host.locator('[data-testid="remote-tile"][data-name="Sam Guest"]');
    await expect(guestTile).toHaveAttribute("data-mic", "on", { timeout: 20_000 });
    await expect(guestTile.locator("audio")).toHaveCount(1);

    // Mute reaches the other side, and mutes the real mic track (so the recording too).
    await host.getByRole("button", { name: "Mute" }).click();
    await expect(hostTile).toHaveAttribute("data-mic", "muted");
    expect((await streamInfo(host)).audio[0]?.state).toBe("live");
    expect(await host.locator("video").first().evaluate((v) =>
      ((v as HTMLVideoElement).srcObject as MediaStream).getAudioTracks()[0]!.enabled)).toBe(false);
    await host.getByRole("button", { name: "Unmute" }).click();
    await expect(hostTile).toHaveAttribute("data-mic", "on");
  });

  const sessionId = new URL(host.url()).pathname.split("/").pop()!;

  await test.step("Record: both record locally and upload; Stop: uploads finish and land in storage", async () => {
    await host.getByRole("button", { name: "Record", exact: true }).click();
    await expect(guest.getByText("You're being recorded.")).toBeVisible();
    await expect(guest.getByText(/REC 00:0\d/)).toBeVisible();
    await expect(host.getByRole("button", { name: "Stop recording" })).toBeVisible();
    await expect(guest.getByTestId("local-upload")).toContainText("Recording on this device");

    await host.waitForTimeout(9_000); // a few 4 s chunks per track

    await host.getByRole("button", { name: "Stop recording" }).click();
    await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();
    await expect(guest.getByText(/REC/)).toHaveCount(0);

    await expect(host.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 30_000 });
    await expect(guest.getByTestId("local-upload")).toContainText("All of your recording is uploaded", { timeout: 30_000 });
    // The host sees both participants finished: host has audio + camera, guest audio only.
    await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/, /✓ Uploaded/], { timeout: 15_000 });

    if (!canReadStorage) return; // deployed stack: storage isn't reachable from the test runner
    const objects = await listChunks(sessionId);
    const tracks = new Set(objects.map((k) => k.split("/")[2]));
    expect(tracks.size).toBe(3);
    for (const track of tracks) {
      const first = objects.find((k) => k.includes(`/${track}/00000000.chunk`));
      expect(first, `track ${track} has a first chunk`).toBeTruthy();
      // Every first chunk starts with the WebM (EBML) header.
      expect((await readObject(first!)).subarray(0, 4).toString("hex")).toBe("1a45dfa3");
    }
    expect(objects.length).toBeGreaterThanOrEqual(3 * 2);
  });

  await test.step("the recording is processed into downloadable, aligned files", async () => {
    const studioPage = await host.context().newPage();
    await studioPage.goto(studioUrl);
    const recording = studioPage.getByTestId("recording").first();
    await expect(recording.getByTestId("recording-status")).toHaveText(/Ready/, { timeout: 90_000 });
    // The timeline: every step done, with when.
    const timeline = recording.getByTestId("timeline");
    expect(await timeline.locator("[data-step]").evaluateAll((els) => els.map((el) => `${el.getAttribute("data-step")}:${el.getAttribute("data-state")}`))).toEqual([
      "recorded:done",
      "uploaded:done",
      "files:done",
    ]);
    await expect(timeline.locator('[data-step="files"]')).toContainText(/Files ready\s*\d/);

    const links = mediaLinks(studioPage);
    expect(await fileNames(links)).toEqual(["Combined.mp4", "Dev Host - audio.wav", "Dev Host - video.mp4", "Sam Guest - audio.wav"]);
    // Shown with friendly titles.
    await expect(links).toHaveText([/Side-by-side video/, /Dev Host's audio/, /Dev Host's video/, /Sam Guest's audio/]);

    const durations: number[] = [];
    const files = await links.evaluateAll((as) =>
      as.map((a) => ({ href: (a as HTMLAnchorElement).href, name: a.getAttribute("data-file-name")! })),
    );
    for (const { href, name } of files) {
      // Fetched by the browser, following the redirect to signed storage like a real download
      // (and resolving *.localhost the way Chromium does, which Node may not). Content-Disposition
      // is not readable cross-origin from page JS, so the name comes from the link.
      const got = await studioPage.evaluate(async (url) => {
        const r = await fetch(url);
        const bytes = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { status: r.status, type: r.headers.get("content-type"), base64: btoa(bin) };
      }, href);
      expect(got.status, name).toBe(200);
      const body = Buffer.from(got.base64, "base64");
      const file = join(mkdtempSync(join(tmpdir(), "tapry-dl-")), name);
      writeFileSync(file, body);
      if (name.endsWith(".wav")) {
        expect(got.type).toBe("audio/wav");
        expect(body.subarray(0, 4).toString()).toBe("RIFF");
        // Levelled (the studio default): at -16 LUFS, or as close as the -1 dBTP peak ceiling allows.
        // Chromium's fake mic beeps, so its peaks are what stop it.
        const { integrated, truePeak } = loudness(file);
        expect(integrated, name).toBeLessThan(-15);
        expect(truePeak, name).toBeLessThan(-0.9);
        expect(integrated > -17 || truePeak > -1.6, `${name}: ${integrated} LUFS, ${truePeak} dBTP`).toBe(true);
      } else {
        expect(got.type).toBe("video/mp4");
        expect(body.subarray(4, 8).toString()).toBe("ftyp");
      }
      durations.push(probeDuration(file));
    }
    // Everything is cut to the recording's length, so the files line up in an editor.
    expect(Math.max(...durations) - Math.min(...durations)).toBeLessThan(0.1);
    expect(durations[0]).toBeGreaterThan(8);
    await studioPage.close();
  });

  await test.step("transcript follows, when the server has Whisper", async () => {
    if (!process.env.WHISPER_MODEL) return;
    const studioPage = await host.context().newPage();
    await studioPage.goto(studioUrl);
    const transcripts = studioPage.getByTestId("recording").first().locator('[data-testid="download"][data-file-name^="Transcript."]');
    await expect(transcripts).toHaveCount(3, { timeout: 120_000 });
    expect(await fileNames(transcripts)).toEqual(["Transcript.srt", "Transcript.txt", "Transcript.vtt"]);
    await studioPage.close();
  });

  await test.step("Download all saves one zip with every file in it", async () => {
    const studioPage = await host.context().newPage();
    await studioPage.goto(studioUrl);
    const recording = studioPage.getByTestId("recording").first();
    const names = await fileNames(recording.getByTestId("download"));
    const [download] = await Promise.all([studioPage.waitForEvent("download"), recording.getByTestId("download-zip").click()]);
    expect(download.suggestedFilename()).toMatch(/^E2E Show \w+ - \d{4}-\d\d-\d\d \d\d\.\d\d UTC\.zip$/);
    const file = join(mkdtempSync(join(tmpdir(), "tapry-zip-")), "all.zip");
    await download.saveAs(file);
    // Python's zipfile checks every CRC and lists what's inside.
    const listed = execFileSync("python3", [
      "-I",
      "-c",
      "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))",
      file,
    ]).toString();
    expect(JSON.parse(listed)).toEqual(names);
    await studioPage.close();
  });

  await test.step("guest goes offline and closes the tab mid-recording; the upload finishes when they return", async () => {
    await host.getByRole("button", { name: "Record", exact: true }).click();
    await expect(guest.getByText("You're being recorded.")).toBeVisible();
    await guest.waitForTimeout(2_000); // let the track register while still online

    await guestContext.setOffline(true);
    await guest.waitForTimeout(9_000); // chunks pile up in the guest's local storage
    await guest.close({ runBeforeUnload: false }); // tab closed (or crashed) while offline

    await host.getByRole("button", { name: "Stop recording" }).click();
    // While the guest is gone, their part stays unfinished (not silently marked done).
    await host.waitForTimeout(3_000);
    await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/, /Offline|Uploading/]);

    // Back online, the guest reopens the session page: leftovers upload on their own,
    // and the cut-off track is completed as interrupted.
    await guestContext.setOffline(false);
    const back = await guestContext.newPage();
    await back.goto(`/session/${sessionId}`);
    await expect(back.getByRole("button", { name: "Join the studio" })).toBeVisible();
    await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/, /✓ Uploaded/], { timeout: 30_000 });

    // The recovered upload completes the recording, which then processes by itself.
    const studioPage = await host.context().newPage();
    await studioPage.goto(studioUrl);
    await expect(studioPage.getByTestId("recording-status")).toHaveText([/Ready/, /Ready/], { timeout: 90_000 });
    await studioPage.close();
  });

  await test.step("a guest who comes back goes through the green room without rejoining", async () => {
    const page = guestContext.pages().at(-1)!;
    await page.reload();
    await expect(page.getByRole("button", { name: "Join the studio" })).toBeVisible();
    await page.goto(inviteUrl);
    await expect(page.getByRole("button", { name: "Continue as Sam Guest" })).toBeVisible();
  });

  await test.step("ending the session tells everyone", async () => {
    // The guest goes back into the room first.
    const guestPage = guestContext.pages().at(-1)!;
    await guestPage.getByRole("button", { name: "Continue as Sam Guest" }).click();
    await guestPage.getByRole("button", { name: "Join the studio" }).click({ timeout: 20_000 });
    await expect(guestPage.getByText("Waiting for the host to start recording.")).toBeVisible();

    host.once("dialog", (d) => d.accept());
    await host.getByRole("button", { name: "End session" }).click();
    await expect(host.getByTestId("session-ended")).toContainText("That's a wrap");
    await expect(host.getByRole("button", { name: "Record", exact: true })).toHaveCount(0);

    // The guest, whose upload is done: their own files from both (processed) episodes, and the
    // "record your own" link. Never anyone else's.
    await expect(guestPage.getByTestId("session-ended")).toContainText("Thanks, Sam Guest. All done!", { timeout: 30_000 });
    const own = guestPage.getByTestId("own-recording");
    await expect(own.locator("a[data-file-name]")).toHaveCount(2, { timeout: 15_000 });
    expect(await own.locator("a[data-file-name]").evaluateAll((as) => as.map((a) => a.getAttribute("data-file-name")))).toEqual([
      "Sam Guest - audio.wav",
      "Sam Guest - audio.wav",
    ]);
    const href = await own.locator("a[data-file-name]").first().getAttribute("href");
    expect(await guestPage.evaluate(async (url) => (await fetch(url!)).status, href)).toBe(200);
    await expect(guestPage.getByTestId("promo")).toHaveAttribute("href", "https://tapry.test/");
  });

  await test.step("host deletes a recording, then the studio; their files leave storage", async () => {
    const studioPage = await host.context().newPage();
    await studioPage.goto(studioUrl);
    const recordings = studioPage.getByTestId("recording");
    await expect(recordings).toHaveCount(2);
    const before = canReadStorage ? (await listChunks(sessionId)).length : 0;

    const first = recordings.first();
    await first.getByTestId("delete-recording").click();
    await expect(first.getByRole("alertdialog")).toContainText("can't be undone");
    await first.getByTestId("delete-recording-confirm").click();
    await expect(recordings).toHaveCount(1);
    if (canReadStorage) {
      // The in-process worker purges right away; the other recording's chunks stay.
      await expect.poll(async () => (await listChunks(sessionId)).length, { timeout: 15_000 }).toBeLessThan(before);
      expect((await listChunks(sessionId)).length).toBeGreaterThan(0);
    }

    await studioPage.getByRole("tab", { name: "Settings" }).click();
    await studioPage.getByTestId("delete-studio").click();
    await studioPage.getByTestId("delete-studio-confirm").click();
    await expect(studioPage).not.toHaveURL(studioUrl);
    await expect(studioPage.getByTestId("show-link").filter({ hasText: studioName })).toHaveCount(0);
    if (canReadStorage) await expect.poll(async () => listChunks(sessionId), { timeout: 15_000 }).toEqual([]);
    await studioPage.close();
  });

  await guestContext.close();
});
