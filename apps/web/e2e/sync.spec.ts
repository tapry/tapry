// How well people's tracks line up, measured end to end.
//
// Each browser's microphone is replaced by a generator that beeps exactly on every whole second
// of the real clock. Both browsers run on this machine, so every beep happens at the same moment
// for both. After recording and processing, the beeps are found in each person's WAV:
//   - between the two WAVs, the same beep should sit at the same position (sync error);
//   - in each WAV, it should sit at (beep time − Record time) (error against Record).
// One device's clock is set 3.7 s wrong, so the clock-offset correction is tested too.
// Length: E2E_SYNC_SECONDS (default 20); the plan's Gate A is E2E_SYNC_SECONDS=3600. Every beep
// must be found in both files and every file must run the full length: that is the zero-loss check.
// The guest is Chromium, or real Safari with E2E_SYNC_GUEST=safari (macOS; see e2e/safari.ts).
// Automated Safari only has mock devices, and its Web Audio clock stalls for hundreds of ms at a
// time, so beeps can't be generated there. Its mock microphone bursts every 1.000 s through the
// real capture path instead, at a phase we can't know. The Safari run checks that every burst is
// in Safari's file, exactly a second apart from end to end: nothing lost, no drift against real
// time. The absolute gap between people needs real devices. Safari against the host is reported,
// not checked: with both browsers on one machine, the host's generated beeps can stall for a few
// hundred ms while Safari starts encoding (in the 60-min run they shifted 740 ms in the first
// seconds, then held), so the host's beeps are counted the same way as Safari's bursts. Safari
// keeps its camera on (MP4 path), and the host's clock is the wrong one.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { createStudio, downloadOutputs, expect, signInHost, test } from "./fixtures";
import { SafariPage } from "./safari";

test.skip(({ browserName }) => browserName !== "chromium", "measured once, in Chromium");

const SECONDS = Number(process.env.E2E_SYNC_SECONDS ?? 20);
const CLOCK_SKEW_MS = 3_700;
const SAFARI = process.env.E2E_SYNC_GUEST === "safari";
const SKEW_HOST = SAFARI || process.env.E2E_SYNC_SKEW === "host";

// Close the guest even when the test fails: Safari takes one automation session at a time.
let closeGuest: (() => Promise<void>) | null = null;
test.afterEach(async () => {
  await closeGuest?.();
  closeGuest = null;
});

/** Replace the mic with beeps on every whole second of the real clock; optionally skew the device clock. */
async function beepingMic(page: Page, skewMs = 0) {
  if (process.env.SYNC_DEBUG) page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`[${skewMs ? "skewed" : "page"} ${m.type()}]`, m.text().slice(0, 200)); });
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

/** Every burst in a track (ms from its start): where the level first rises past 30% of its peak. */
function burstOnsets(samples: Float32Array) {
  let max = 0;
  for (const x of samples) max = Math.max(max, Math.abs(x));
  const threshold = max * 0.3;
  const out: number[] = [];
  let quietUntil = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) <= threshold) continue;
    if (i >= quietUntil) out.push((i * 1000) / 48_000);
    quietUntil = i + 48 * 300; // a burst lasts ~70 ms; the next starts a second later
  }
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
  test.setTimeout(300_000 + SECONDS * 3_000);
  await beepingMic(host, SKEW_HOST ? CLOCK_SKEW_MS : 0);
  await signInHost(host);
  const { studioUrl, inviteUrl } = await createStudio(host, `Sync ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });
  await expect(host.getByText("Connected", { exact: true })).toBeVisible();

  closeGuest = SAFARI ? await joinSafari(inviteUrl) : await joinChromium(browser, inviteUrl);

  const sessionId = new URL(host.url()).pathname.split("/").pop()!;
  await host.getByRole("button", { name: "Record", exact: true }).click();
  await host.waitForTimeout(SECONDS * 1000);
  await host.getByRole("button", { name: "Stop recording" }).click();
  await expect(host.getByTestId("participant-upload")).toHaveText([/✓ Uploaded/, /✓ Uploaded/], { timeout: 60_000 });

  const { recording } = await host.evaluate(async (id) => {
    const { token } = JSON.parse(localStorage.getItem(`tapry:ticket:${id}`)!);
    return (await fetch(`/api/sessions/${id}/state`, { headers: { authorization: `Bearer ${token}` } })).json();
  }, sessionId);

  await host.goto(studioUrl);
  // Processing takes time in proportion to the length (an hour of video: many minutes).
  await expect(host.getByTestId("recording-status").first()).toHaveText(/Ready/, { timeout: Math.max(120_000, SECONDS * 1_000) });
  const files = await downloadOutputs(host);
  const wavs = files.filter((f) => f.name.endsWith(".wav"));
  expect(wavs.map((f) => f.name)).toEqual(["Dev Host - audio.wav", "Sync Guest - audio.wav"]);

  // Every whole second inside the recording, except the first and last (edges are cut).
  const expected: number[] = [];
  for (let s = Math.ceil(recording.startedAt / 1000) * 1000 + 1000; s < recording.stoppedAt - 1000; s += 1000) expected.push(s - recording.startedAt);
  if (SAFARI) return checkSafari(wavs, files, recording, expected);
  const [hostOnsets, guestOnsets] = wavs.map((f) => beepOnsets(wavSamples(f.path), expected));

  const pairs = expected.flatMap((e, i) => (hostOnsets![i] != null && guestOnsets![i] != null ? [{ e, h: hostOnsets![i]!, g: guestOnsets![i]! }] : []));
  const between = stats(pairs.map((p) => p.h - p.g));
  const hostVsRecord = stats(pairs.map((p) => p.h - p.e));
  const guestVsRecord = stats(pairs.map((p) => p.g - p.e));
  const drift = pairs.length > 1 ? pairs.at(-1)!.h - pairs.at(-1)!.g - (pairs[0]!.h - pairs[0]!.g) : 0;
  const report = { seconds: SECONDS, beeps: expected.length, found: pairs.length, betweenMs: between, hostVsRecordMs: hostVsRecord, guestVsRecordMs: guestVsRecord, driftMs: Math.round(drift) };
  console.log("SYNC", JSON.stringify(report));
  if (process.env.SYNC_DEBUG) console.log("PAIRS", JSON.stringify(pairs.map((p) => [Math.round(p.e), Math.round(p.h - p.e), Math.round(p.g - p.e)])), JSON.stringify(recording));
  test.info().annotations.push({ type: "sync", description: JSON.stringify(report) });

  // Zero loss: every beep is in both files (a lost or skipped chunk would leave a gap without
  // its beeps), and every file runs the whole recording.
  const lengthS = (recording.stoppedAt - recording.startedAt) / 1000;
  for (const f of files) expect(Math.abs(f.duration - lengthS), f.name).toBeLessThan(0.1);
  expect(pairs.length).toBe(expected.length);
  // The plan's Gate A: under 50 ms between people.
  expect(between.max).toBeLessThan(50);
});

type Recording = { startedAt: number; stoppedAt: number };
type Output = { name: string; path: string; duration: number };

function checkSafari(wavs: Output[], files: Output[], recording: Recording, expected: number[]) {
  const lengthMs = recording.stoppedAt - recording.startedAt;
  // Both tracks' bursts inside the same window as the beeps (the edges are cut).
  const [host, bursts] = wavs.map((f) => burstOnsets(wavSamples(f.path)).filter((b) => b > 500 && b < lengthMs - 500));
  const gaps = bursts!.slice(1).map((b, i) => b - bursts![i]!);
  // Safari against the host, beep by beep (reported only; see the top of the file).
  const offsets = host!.map((h) => bursts!.reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a), Infinity) - h);
  const report = {
    seconds: SECONDS,
    browser: "safari",
    hostBeeps: expected.length,
    hostFound: host!.length,
    safariBursts: bursts!.length,
    burstGapMs: { min: Math.min(...gaps), max: Math.max(...gaps) },
    safariVsHostMs: { first: offsets[0], last: offsets.at(-1), min: Math.min(...offsets), max: Math.max(...offsets) },
  };
  console.log("SYNC", JSON.stringify(report));
  if (process.env.SYNC_DEBUG) console.log("OFFSETS", JSON.stringify(offsets.map(Math.round)));
  test.info().annotations.push({ type: "sync", description: JSON.stringify(report) });

  for (const f of files) expect(Math.abs(f.duration - lengthMs / 1000), f.name).toBeLessThan(0.1);
  // Zero loss in the host's track: every beep is there (a lost chunk would take four with it).
  expect(report.hostFound).toBeGreaterThanOrEqual(Math.floor(lengthMs / 1000) - 2);
  // Zero loss and no drift in Safari's track: a burst every second from end to end, none missing
  // or doubled, each exactly a second after the last (a lost or misplaced chunk breaks that).
  expect(report.safariBursts).toBeGreaterThanOrEqual(Math.floor(lengthMs / 1000) - 2);
  expect(report.burstGapMs.min).toBeGreaterThan(990);
  expect(report.burstGapMs.max).toBeLessThan(1010);
}

async function joinChromium(browser: Browser, inviteUrl: string) {
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await beepingMic(guest, SKEW_HOST ? 0 : CLOCK_SKEW_MS);
  await guest.goto(inviteUrl);
  await guest.getByLabel("Your name").fill("Sync Guest");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.getByRole("combobox", { name: "Camera" }).selectOption("off");
  await guest.getByRole("button", { name: "Join the studio" }).click();
  await expect(guest.getByText("Waiting for the host to start recording.")).toBeVisible();
  return () => guestContext.close();
}

async function joinSafari(inviteUrl: string) {
  const guest = await SafariPage.launch();
  try {
    await guest.goto(new URL(inviteUrl, test.info().project.use.baseURL).href);
    // Wait for React to hydrate the form: a box ticked before that is unticked again.
    await guest.element(
      (l) => [...document.querySelectorAll("input")].find((i) => i.name === l && Object.keys(i).some((k) => k.startsWith("__reactProps"))),
      "consent",
    );
    await guest.type(await guest.input("Your name"), "Sync Guest");
    // A WebDriver click on the box sometimes doesn't tick it in Safari; a click from the page does.
    await guest.jsClick(await guest.input("happy to be recorded"));
    await guest.element((n) => (document.querySelector<HTMLInputElement>(`input[name=${n}]`)?.checked ? document.body : null), "consent", 5_000);
    await guest.click(await guest.button("Continue"));
    await guest.click(await guest.button("Join the studio"));
    await guest.waitForText("Waiting for the host to start recording.");
  } catch (e) {
    await guest.close();
    throw e;
  }
  return () => guest.close();
}
