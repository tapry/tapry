import { describe, expect, it } from "vitest";
import {
  alertAdvice,
  alertLabel,
  CLIP_WINDOW_MS,
  MicAlerts,
  SILENT_AFTER_MS,
  uploadBehindS,
} from "../src/lib/client/quality";
import { expectOk, setup } from "./harness";

describe("mic alerts (on the device)", () => {
  it("flags clipping after more than 3 clips within 10 s, and lets it go once they stop", () => {
    const mic = new MicAlerts(0);
    for (const t of [100, 200, 300]) mic.addPeak(0.99, t);
    expect(mic.alerts(400, false)).toEqual([]); // 3 is a loud laugh, not a problem
    mic.addPeak(0.95, 500);
    expect(mic.alerts(600, false)).toEqual(["clipping"]);
    expect(mic.alerts(500 + CLIP_WINDOW_MS + 1, false)).toEqual([]);
  });

  it("doesn't count loud but clean speech as clipping", () => {
    const mic = new MicAlerts(0);
    for (let t = 0; t < 5000; t += 100) mic.addPeak(0.8, t); // about -2 dBFS
    expect(mic.alerts(5000, false)).toEqual([]);
  });

  it("flags a silent mic after 30 s unmuted, never while muted, and clears when sound returns", () => {
    const mic = new MicAlerts(0);
    for (let t = 0; t <= SILENT_AFTER_MS; t += 100) mic.addPeak(0.0005, t);
    expect(mic.alerts(SILENT_AFTER_MS, false)).toEqual(["mic_silent"]);
    expect(mic.alerts(SILENT_AFTER_MS, true)).toEqual([]);
    mic.addPeak(0.1, SILENT_AFTER_MS + 100);
    expect(mic.alerts(SILENT_AFTER_MS + 200, false)).toEqual([]);
  });

  it("starts the silence clock again after unmuting", () => {
    const mic = new MicAlerts(0);
    mic.reset(SILENT_AFTER_MS + 5000); // unmuted just now after a long mute
    expect(mic.alerts(SILENT_AFTER_MS + 6000, false)).toEqual([]);
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
      { participantId: t.guest.participantId, alerts: ["clipping", "tab_hidden"], uploadBehindS: null, reportedAt: t.now() },
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
});
