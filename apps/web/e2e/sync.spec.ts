// How well people's tracks line up, measured end to end.
//
// Each browser's microphone is replaced by a generator that beeps exactly on every whole second
// of the real clock. Both browsers run on this machine, so every beep happens at the same moment
// for both. After recording and processing, the beeps are found in each person's WAV:
//   - between the two WAVs, the same beep should sit at the same position (sync error);
//   - in each WAV, it should sit at (beep time − Record time) (error against Record).
// The guest's device clock is set 3.7 s wrong, so the clock-offset correction is tested too.
// Length: E2E_SYNC_SECONDS (default 20); the plan's Gate A asks for 60 minutes.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { createStudio, downloadOutputs, expect, signInHost, test } from "./fixtures";

test.skip(({ browserName }) => browserName !== "chromium", "measured once, in Chromium");

const SECONDS = Number(process.env.E2E_SYNC_SECONDS ?? 20);
const GUEST_CLOCK_SKEW_MS = 3_700;

/** Replace the mic with beeps on every whole second of the real clock; optionally skew the device clock. */
async function beepingMic(page: Page, skewMs = 0) {
  if (process.env.SYNC_DEBUG) page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`[${skewMs ? "guest" : "host"} ${m.type()}]`, m.text().slice(0, 200)); });
  await page.addInitScript((skew: number) => {
    const realDateNow = Date.now.bind(Date);
    const realOrigin = performance.timeOrigin;
    if (skew) {
      // A device whose clock is wrong: both the wall clock and the page's time origin are off.
      Date.now = () => realDateNow() + skew;
      Object.defineProperty(performance, "timeOrigin", { configurable: true, get: () => realOrigin + skew });
    }
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let ctx: AudioContext | null = null;
    let dest: MediaStreamAudioDestinationNode | null = null;
    const start = () => {
      ctx = new AudioContext({ sampleRate: 48_000 });
      dest = ctx.createMediaStreamDestination();
      void ctx.resume();
      let scheduledUntil = 0;
      const schedule = () => {
        if (!ctx || ctx.state !== "running") return;
        const stamp = ctx.getOutputTimestamp();
        // Audio-context time for a real wall-clock moment (ms since 1970).
        const at = (wall: number) => stamp.contextTime! + (wall - (realOrigin + stamp.performanceTime!)) / 1000;
        const nowWall = realOrigin + performance.now();
        for (let s = Math.ceil(Math.max(nowWall + 100, scheduledUntil) / 1000) * 1000; s < nowWall + 1500; s += 1000) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 1000;
          gain.gain.value = 0.5;
          osc.connect(gain).connect(dest!);
          osc.start(at(s));
          osc.stop(at(s) + 0.04);
          scheduledUntil = s + 1;
        }
      };
      setInterval(schedule, 200);
    };
    navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const video = constraints?.video ? await getUserMedia({ video: constraints.video }) : null;
      if (!ctx) start();
      const tracks = [...(video?.getVideoTracks() ?? [])];
      if (constraints?.audio) tracks.push(dest!.stream.getAudioTracks()[0]!.clone());
      return new MediaStream(tracks);
    };
  }, skewMs);
}

/** Mono 16-bit samples of a WAV, as floats (walks the RIFF chunks to "data"). */
function wavSamples(path: string) {
  const buf = readFileSync(path);
  let at = 12;
  while (buf.subarray(at, at + 4).toString() !== "data") at += 8 + buf.readUInt32LE(at + 4);
  const start = at + 8;
  const n = buf.readUInt32LE(at + 4) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(start + i * 2) / 32768;
  return out;
}

/** Where each expected beep actually starts in a track (ms from its start), searching ±400 ms. */
function beepOnsets(samples: Float32Array, expectedMs: number[]) {
  let max = 0;
  for (const x of samples) max = Math.max(max, Math.abs(x));
  const threshold = max * 0.2;
  return expectedMs.map((e) => {
    const from = Math.max(0, Math.round(((e - 400) * 48_000) / 1000));
    const to = Math.min(samples.length, Math.round(((e + 400) * 48_000) / 1000));
    for (let i = from; i < to; i++) if (Math.abs(samples[i]!) > threshold) return (i * 1000) / 48_000;
    return null;
  });
}

const stats = (xs: number[]) => {
  const abs = xs.map(Math.abs).sort((a, b) => a - b);
  return { median: abs[Math.floor(abs.length / 2)]!, max: abs.at(-1)!, n: xs.length };
};

test("tracks line up: the same moment lands at the same place in everyone's files", async ({ page: host, browser }) => {
  test.setTimeout(240_000 + SECONDS * 3_000);
  await beepingMic(host);
  await signInHost(host);
  const { studioUrl, inviteUrl } = await createStudio(host, `Sync ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await beepingMic(guest, GUEST_CLOCK_SKEW_MS);
  await guest.goto(inviteUrl);
  await guest.getByLabel("Your name").fill("Sync Guest");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.getByRole("combobox", { name: "Camera" }).selectOption("off");
  await guest.getByRole("button", { name: "Join the studio" }).click();
  await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();

  // The guest's clock is 3.7 s off; its estimate must have found that.
  const sessionId = new URL(host.url()).pathname.split("/").pop()!;
  await host.getByRole("button", { name: "Record", exact: true }).click();
  await expect(guest.getByText("You're being recorded.")).toBeVisible();
  await host.waitForTimeout(SECONDS * 1000);
  await host.getByRole("button", { name: "Stop recording" }).click();
  await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/, /✓ Uploaded/], { timeout: 60_000 });

  const { recording } = await host.evaluate(async (id) => {
    const { token } = JSON.parse(localStorage.getItem(`opentake:ticket:${id}`)!);
    return (await fetch(`/api/sessions/${id}/state`, { headers: { authorization: `Bearer ${token}` } })).json();
  }, sessionId);

  await host.goto(studioUrl);
  await expect(host.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: 120_000 });
  const wavs = (await downloadOutputs(host)).filter((f) => f.name.endsWith(".wav"));
  expect(wavs.map((f) => f.name)).toEqual(["Dev Host - audio.wav", "Sync Guest - audio.wav"]);

  // Every whole second inside the recording, except the first and last (edges are cut).
  const expected: number[] = [];
  for (let s = Math.ceil(recording.startedAt / 1000) * 1000 + 1000; s < recording.stoppedAt - 1000; s += 1000) expected.push(s - recording.startedAt);
  const [hostOnsets, guestOnsets] = wavs.map((f) => beepOnsets(wavSamples(f.path), expected));

  const pairs = expected.flatMap((e, i) => (hostOnsets![i] != null && guestOnsets![i] != null ? [{ e, h: hostOnsets![i]!, g: guestOnsets![i]! }] : []));
  const between = stats(pairs.map((p) => p.h - p.g));
  const hostVsRecord = stats(pairs.map((p) => p.h - p.e));
  const guestVsRecord = stats(pairs.map((p) => p.g - p.e));
  const drift = pairs.length > 1 ? pairs.at(-1)!.h - pairs.at(-1)!.g - (pairs[0]!.h - pairs[0]!.g) : 0;
  const report = { seconds: SECONDS, beeps: expected.length, found: pairs.length, betweenMs: between, hostVsRecordMs: hostVsRecord, guestVsRecordMs: guestVsRecord, driftMs: Math.round(drift) };
  console.log("SYNC", JSON.stringify(report));
  test.info().annotations.push({ type: "sync", description: JSON.stringify(report) });

  expect(pairs.length).toBeGreaterThanOrEqual(expected.length - 1);
  // The plan's Gate A: under 50 ms between people.
  expect(between.max).toBeLessThan(50);
  await guestContext.close();
});
