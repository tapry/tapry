import { describe, expect, it } from "vitest";
import {
  alertAdvice,
  alertLabel,
  CLIP_WINDOW_MS,
  ECHO_WINDOW_MS,
  EchoDetector,
  MicAlerts,
  QUIET_MIN_TALK_MS,
  SILENT_AFTER_MS,
  TALK_NUDGE_AFTER_MS,
  talkNudge,
  talkShares,
  uploadBehindS,
} from "../src/lib/client/quality";
import { expectOk, setup } from "./harness";

describe("mic alerts (on the device)", () => {
  it("flags clipping after more than 3 clips within 10 s, and lets it go once they stop", () => {
    const mic = new MicAlerts(0);
    for (const t of [100, 200, 300]) mic.addLevel(0.99, -100, t);
    expect(mic.alerts(400, false)).toEqual([]); // 3 is a loud laugh, not a problem
    mic.addLevel(0.95, -100, 500);
    expect(mic.alerts(600, false)).toEqual(["clipping"]);
    expect(mic.alerts(500 + CLIP_WINDOW_MS + 1, false)).toEqual([]);
  });

  it("doesn't count loud but clean speech as clipping", () => {
    const mic = new MicAlerts(0);
    for (let t = 0; t < 5000; t += 100) mic.addLevel(0.8, -100, t); // about -2 dBFS
    expect(mic.alerts(5000, false)).toEqual([]);
  });

  it("flags a silent mic after 30 s unmuted, never while muted, and clears when sound returns", () => {
    const mic = new MicAlerts(0);
    for (let t = 0; t <= SILENT_AFTER_MS; t += 100) mic.addLevel(0.0005, -100, t);
    expect(mic.alerts(SILENT_AFTER_MS, false)).toEqual(["mic_silent"]);
    expect(mic.alerts(SILENT_AFTER_MS, true)).toEqual([]);
    mic.addLevel(0.1, -100, SILENT_AFTER_MS + 100);
    expect(mic.alerts(SILENT_AFTER_MS + 200, false)).toEqual([]);
  });

  it("starts the silence clock again after unmuting", () => {
    const mic = new MicAlerts(0);
    mic.reset(SILENT_AFTER_MS + 5000); // unmuted just now after a long mute
    expect(mic.alerts(SILENT_AFTER_MS + 6000, false)).toEqual([]);
  });
});

/** Feed readings every 100 ms: `talking(t)` decides speech (at speechDb) or room noise (-58 dBFS). */
function feed(mic: MicAlerts, from: number, to: number, talking: (t: number) => boolean, speechDb = -20, countTalk = true) {
  for (let t = from; t < to; t += 100) {
    const rmsDb = talking(t) ? speechDb : -58;
    mic.addLevel(10 ** ((rmsDb + 6) / 20), rmsDb, t, countTalk);
  }
}
// Speech with gaps: 1.5 s of words, then 1 s of pause.
const conversational = (t: number) => t % 2500 < 1500;

describe("voice activity and talk time (on the device)", () => {
  it("counts talking, not room noise, and bridges the gaps between words", () => {
    const mic = new MicAlerts(0);
    feed(mic, 0, 20_000, () => false); // listening
    expect(mic.talkMs).toBe(0);
    feed(mic, 20_000, 40_000, (t) => t % 500 < 300); // words with 200 ms gaps: all of it is talking
    expect(mic.talkMs).toBeGreaterThan(19_000);
    expect(mic.talkMs).toBeLessThanOrEqual(20_000);
  });

  it("adapts to a noisy room instead of calling the noise talk", () => {
    const mic = new MicAlerts(0);
    for (let t = 0; t < 60_000; t += 100) mic.addLevel(0.03, -40, t, true); // a loud fan, steady
    expect(mic.talkMs).toBeLessThan(500);
  });

  it("counts only while counting is on, and from zero after resetTalk", () => {
    const mic = new MicAlerts(0);
    feed(mic, 0, 10_000, conversational, -20, false);
    expect(mic.talkMs).toBe(0);
    feed(mic, 10_000, 20_000, conversational);
    // Four stretches of 1.5 s, each carried on by the 400 ms hangover: 7.6 s.
    expect(mic.talkMs).toBeGreaterThanOrEqual(7_400);
    expect(mic.talkMs).toBeLessThanOrEqual(7_600);
    mic.resetTalk();
    expect(mic.talkMs).toBe(0);
  });
});

describe("too quiet (on the device)", () => {
  it("flags someone who talks but stays below -38 dBFS, and clears once they're louder", () => {
    const mic = new MicAlerts(0);
    feed(mic, 0, 30_000, conversational, -45);
    expect(mic.alerts(30_000, false)).toContain("too_quiet");
    expect(mic.alerts(30_000, true)).not.toContain("too_quiet"); // muted: nothing to fix
    feed(mic, 30_000, 33_000, () => true, -25);
    expect(mic.alerts(33_000, false)).not.toContain("too_quiet");
  });

  it("leaves a good level, a listener and a short quiet remark alone", () => {
    const good = new MicAlerts(0);
    feed(good, 0, 30_000, conversational, -22);
    expect(good.alerts(30_000, false)).toEqual([]);
    const listener = new MicAlerts(0);
    feed(listener, 0, 30_000, () => false);
    expect(listener.alerts(30_000, false)).toEqual([]);
    const brief = new MicAlerts(0);
    feed(brief, 0, 30_000, (t) => t >= 20_000 && t < 20_000 + QUIET_MIN_TALK_MS - 1000, -45);
    expect(brief.alerts(30_000, false)).toEqual([]);
  });
});

/** Speech-like levels, one per 100 ms: words and pauses of random length (seeded). */
function speechLevels(n: number, seed: number, loudDb = -20) {
  let x = seed;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const out: number[] = [];
  while (out.length < n) {
    const talking = rand() < 0.5;
    for (let i = 0, len = 2 + Math.floor(rand() * 15); i < len; i++) out.push(talking ? loudDb - rand() * 10 : -60 - rand() * 3);
  }
  return out.slice(0, n);
}

describe("echo (on the device)", () => {
  const run = (far: number[], near: number[]) => {
    const echo = new EchoDetector();
    far.forEach((f, i) => echo.add(f, near[i]!, i * 100));
    return echo.echo();
  };
  const N = ECHO_WINDOW_MS / 100;

  it("flags a mic that records the call from the speakers, a little later and quieter", () => {
    const far = speechLevels(N, 1);
    const noise = speechLevels(N, 9).map(() => -58);
    const near = far.map((f, i) => Math.max(noise[i]!, (far[i - 1] ?? -60) - 20)); // 100 ms later, 20 dB down
    expect(run(far, near)).toBe(true);
  });

  it("leaves a normal conversation alone: people take turns", () => {
    const far = speechLevels(N, 2);
    const near = far.map((f) => (f > -40 ? -60 : -22)); // talks when the others don't
    expect(run(far, near)).toBe(false);
  });

  it("leaves people talking over each other alone, and a call where the others barely speak", () => {
    expect(run(speechLevels(N, 3), speechLevels(N, 4))).toBe(false);
    const quietFar = speechLevels(N, 5).map((f, i) => (i < 30 ? f : -60));
    expect(run(quietFar, quietFar.map((f) => f - 20))).toBe(false);
  });

  it("doesn't blame the person whose own voice comes back from someone else's speakers", () => {
    const near = speechLevels(N, 7); // they talk...
    const far = near.map((_, i) => Math.max(-62, (near[i - 4] ?? -60) - 15)); // ...and hear it back 400 ms later
    expect(run(far, near)).toBe(false);
    // The other end, whose speakers leak: their mic follows what the call plays them.
    expect(run(near, near.map((_, i) => Math.max(-58, (near[i - 1] ?? -60) - 20)))).toBe(true);
  });

  it("forgets echo once it stops (headphones on)", () => {
    const echo = new EchoDetector();
    const far = speechLevels(2 * N, 6);
    far.forEach((f, i) => echo.add(f, i < N ? f - 20 : -60, i * 100));
    expect(echo.echo()).toBe(false);
  });
});

describe("talk balance (host)", () => {
  const report = (participantId: string, recordingId: string, ms: number) => ({
    participantId,
    alerts: [],
    uploadBehindS: null,
    talk: { recordingId, ms },
    reportedAt: 0,
  });

  it("splits the talking of this recording between people, once there is enough of it", () => {
    expect(talkShares([report("host", "rec_1", 10_000), report("guest", "rec_1", 5_000)], "rec_1")).toBeNull();
    const shares = talkShares(
      [report("host", "rec_1", 30_000), report("guest", "rec_1", 90_000), report("old", "rec_0", 500_000)],
      "rec_1",
    );
    expect(shares).toEqual(new Map([["host", 0.25], ["guest", 0.75]]));
  });

  it("nudges the host at 70% after two minutes of talking, not before", () => {
    const early = [report("host", "rec_1", 80_000), report("guest", "rec_1", 10_000)];
    expect(talkNudge(early, "rec_1", "host")).toBeNull();
    const later = [report("host", "rec_1", TALK_NUDGE_AFTER_MS), report("guest", "rec_1", 30_000)];
    expect(talkNudge(later, "rec_1", "host")).toMatch(/80% of the talking/);
    expect(talkNudge(later, "rec_1", "guest")).toBeNull();
    expect(talkNudge([report("host", "rec_1", 500_000)], "rec_1", "host")).toBeNull(); // alone: nobody to leave room for
  });
});

describe("upload lag", () => {
  const progress = (oldestPendingTs: number | null) =>
    ({ oldestPendingTs, pendingChunks: 1, pendingBytes: 1, uploadedChunks: 0, uploadedBytes: 0, pendingTracks: 0, lastError: null, idle: false }) as const;

  it("is the age of the oldest unsent chunk, or null when caught up", () => {
    expect(uploadBehindS(progress(10_000), 100_000)).toBe(90);
    expect(uploadBehindS(progress(null), 100_000)).toBeNull();
    expect(uploadBehindS(null, 100_000)).toBeNull();
  });

  it("reads as minutes for the host and as advice for the person", () => {
    expect(alertLabel("upload_behind", 90)).toBe("Upload behind");
    expect(alertLabel("upload_behind", 185)).toBe("Upload 3 min behind");
    expect(alertAdvice("upload_behind", 185)).toMatch(/3 minutes behind.*safe on this computer/);
    expect(alertAdvice("tab_hidden", null)).toBeNull(); // nothing to tell someone who isn't looking
  });
});

describe("quality reports (server)", () => {
  it("shows each device's latest alerts in the session state", async () => {
    const t = await setup();
    await expectOk(t.call(`/sessions/${t.sessionId}/telemetry`, { alerts: ["tab_hidden", "clipping"], uploadBehindS: null }));
    const state = (await expectOk(t.client({ token: t.host.token }).get(`/sessions/${t.sessionId}/state`))).body;
    expect(state.health).toEqual([
      { participantId: t.guest.participantId, alerts: ["clipping", "tab_hidden"], uploadBehindS: null, talk: null, reportedAt: t.now() },
    ]);
  });

  it("accepts only known alert codes, and only from people in the session", async () => {
    const t = await setup();
    const bad = await t.call(`/sessions/${t.sessionId}/telemetry`, { alerts: ["camera_on_fire"], uploadBehindS: null });
    expect(bad.status).toBe(400);
    const anonymous = await t.call(`/sessions/${t.sessionId}/telemetry`, { alerts: [], uploadBehindS: null }, null);
    expect(anonymous.status).toBe(401);
  });

  it("pushes a report to the session only when something the host sees changed", async () => {
    const t = await setup();
    const snapshots: unknown[] = [];
    const unsubscribe = await t.services.live.subscribe(t.sessionId, (s) => snapshots.push(s));
    const report = (alerts: string[], uploadBehindS: number | null) =>
      expectOk(t.call(`/sessions/${t.sessionId}/telemetry`, { alerts, uploadBehindS }));
    const settle = () => new Promise((r) => setTimeout(r, 400));

    await report(["no_headphones"], null);
    await settle();
    const afterFirst = snapshots.length;
    await report(["no_headphones"], null); // the same again: a heartbeat
    await report(["no_headphones"], null);
    await settle();
    expect(snapshots.length).toBe(afterFirst);
    await report(["no_headphones", "upload_behind"], 70);
    await settle();
    expect(snapshots.length).toBe(afterFirst + 1);
    unsubscribe();
  });

  it("carries talk time, pushing it in 5-second steps", async () => {
    const t = await setup();
    const snapshots: unknown[] = [];
    const unsubscribe = await t.services.live.subscribe(t.sessionId, (s) => snapshots.push(s));
    const report = (ms: number) =>
      expectOk(t.call(`/sessions/${t.sessionId}/telemetry`, { alerts: [], uploadBehindS: null, talk: { recordingId: "rec_x", ms } }));
    const settle = () => new Promise((r) => setTimeout(r, 400));
    await report(1_000);
    await settle();
    const afterFirst = snapshots.length;
    await report(3_000); // same 5-s step
    await settle();
    expect(snapshots.length).toBe(afterFirst);
    await report(6_000);
    await settle();
    expect(snapshots.length).toBe(afterFirst + 1);
    const state = (await expectOk(t.client({ token: t.host.token }).get(`/sessions/${t.sessionId}/state`))).body;
    expect(state.health[0].talk).toEqual({ recordingId: "rec_x", ms: 6_000 });
    unsubscribe();
  });
});
