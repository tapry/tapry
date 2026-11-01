import { studioSettings } from "@tapry/shared";
import { describe, expect, it } from "vitest";
import { estimateClock } from "../src/lib/client/clock";
import { parseSse } from "../src/lib/client/session-events";
import {
  browserChecks,
  buildConstraints,
  classifyLevel,
  describeMediaError,
  looksLikeHeadphones,
  measureLevel,
  meterFraction,
  meterRelease,
  networkCheck,
  storageCheck,
  withoutDeviceIds,
  type BrowserEnv,
} from "../src/lib/media/media";

const defaults = studioSettings.parse({});

describe("buildConstraints", () => {
  it("asks for 1080p30 and clean 48 kHz audio with AGC off", () => {
    const c = buildConstraints(defaults, { headphones: false });
    expect(c.video).toEqual({ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } });
    expect(c.audio).toMatchObject({ sampleRate: { ideal: 48_000 }, autoGainControl: false });
  });

  it("asks for no camera at all in an audio-only show", () => {
    expect(buildConstraints({ ...defaults, audioOnly: true }, { headphones: false }).video).toBe(false);
  });

  it("uses 720p when the studio says so", () => {
    const c = buildConstraints({ ...defaults, videoQuality: "720p" }, { headphones: false });
    expect(c.video).toMatchObject({ width: { ideal: 1280 }, height: { ideal: 720 } });
  });

  it("turns echo cancellation and noise suppression off for headphone users", () => {
    expect(buildConstraints(defaults, { headphones: false }).audio).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
    });
    expect(buildConstraints(defaults, { headphones: true }).audio).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
    });
  });

  it("never processes audio when the studio disables echo cancellation", () => {
    const c = buildConstraints({ ...defaults, echoCancellation: false }, { headphones: false });
    expect(c.audio).toMatchObject({ echoCancellation: false });
  });

  it("pins chosen devices, drops video when the camera is off, and can unpin", () => {
    const c = buildConstraints(defaults, { headphones: false, audioDeviceId: "mic1", videoDeviceId: "cam1" });
    expect(c.audio).toMatchObject({ deviceId: { exact: "mic1" } });
    expect(c.video).toMatchObject({ deviceId: { exact: "cam1" } });
    const loose = withoutDeviceIds(c);
    expect(loose.audio).not.toHaveProperty("deviceId");
    expect(loose.video).not.toHaveProperty("deviceId");
    expect(buildConstraints(defaults, { headphones: false, cameraOff: true }).video).toBe(false);
  });
});

describe("describeMediaError", () => {
  const err = (name: string) => Object.assign(new Error(name), { name });

  it("explains each getUserMedia failure in plain words", () => {
    expect(describeMediaError(err("NotAllowedError")).title).toMatch(/blocked/);
    expect(describeMediaError(err("NotFoundError")).title).toMatch(/No microphone/);
    expect(describeMediaError(err("NotReadableError")).help).toMatch(/Zoom, Teams/);
  });

  it("falls back to default devices when a saved device is gone", () => {
    expect(describeMediaError(err("OverconstrainedError")).retryWithDefaults).toBe(true);
  });
});

describe("mic level", () => {
  const sine = (amplitude: number, n = 2048) =>
    Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * i) / 64));

  it("measures RMS and peak in dBFS", () => {
    const { rmsDb, peakDb } = measureLevel(sine(1));
    expect(peakDb).toBeCloseTo(0, 1);
    expect(rmsDb).toBeCloseTo(-3.01, 1); // a full-scale sine is 3 dB below its peak
    expect(measureLevel(new Float32Array(128)).rmsDb).toBe(-100);
  });

  it("classifies silence, quiet speech, good speech and clipping", () => {
    expect(classifyLevel(-80, -70)).toBe("silent");
    expect(classifyLevel(-45, -30)).toBe("quiet");
    expect(classifyLevel(-20, -6)).toBe("good");
    expect(classifyLevel(-10, -0.2)).toBe("clipping");
  });

  it("meter jumps up at once and falls at a steady rate", () => {
    expect(meterRelease(-50, -10, 16)).toBe(-10);
    expect(meterRelease(-10, -100, 500)).toBe(-22); // 24 dB/s for 0.5 s
    // A word every second keeps the bar well above the floor in between.
    expect(meterRelease(-10, -100, 1000)).toBeGreaterThan(-60);
  });

  it("maps dB to a meter fraction", () => {
    expect(meterFraction(-100)).toBe(0);
    expect(meterFraction(-30)).toBe(0.5);
    expect(meterFraction(3)).toBe(1);
  });
});

describe("looksLikeHeadphones", () => {
  it.each([
    ["Default - AirPods Pro (Bluetooth)", true],
    ["Jabra Evolve2 65", true],
    ["External Headphones", true],
    ["WH-1000XM4", true],
    ["MacBook Pro Speakers", false],
    ["Headset speakerphone", false],
    ["", false],
  ])("%s → %s", (label, expected) => {
    expect(looksLikeHeadphones(label)).toBe(expected);
  });
});

describe("browser checks", () => {
  const chrome: BrowserEnv = {
    isSecureContext: true,
    hasMediaRecorder: true,
    isTypeSupported: (t) => t === "video/webm;codecs=vp9,opus",
    hasIndexedDB: true,
    userAgent: "Mozilla/5.0 (Macintosh) Chrome/130",
  };

  it("passes a desktop Chromium browser", () => {
    const checks = browserChecks(chrome);
    expect(checks.every((c) => c.tone === "ok")).toBe(true);
    expect(checks.find((c) => c.id === "recorder")?.label).toContain("video/webm");
  });

  it("blocks insecure pages, missing MediaRecorder and missing storage", () => {
    const tones = (env: Partial<BrowserEnv>) =>
      browserChecks({ ...chrome, ...env }).filter((c) => c.tone === "danger").map((c) => c.id);
    expect(tones({ isSecureContext: false })).toEqual(["https"]);
    expect(tones({ hasMediaRecorder: false })).toEqual(["recorder"]);
    expect(tones({ isTypeSupported: () => false })).toEqual(["recorder"]);
    expect(tones({ hasIndexedDB: false })).toEqual(["storage-api"]);
  });

  it("warns phone users about backgrounding", () => {
    const checks = browserChecks({ ...chrome, userAgent: "Mozilla/5.0 (iPhone) Safari" });
    expect(checks.find((c) => c.id === "mobile")?.tone).toBe("warn");
  });

  it("reports disk space and latency", () => {
    expect(storageCheck(10 * 1024 ** 3, true)).toMatchObject({ tone: "ok", label: "10.0 GB free for the local backup" });
    expect(storageCheck(1024 ** 3, false).tone).toBe("warn");
    expect(storageCheck(null, true).tone).toBe("ok");
    expect(networkCheck(40).tone).toBe("ok");
    expect(networkCheck(900).tone).toBe("warn");
    expect(networkCheck(null).tone).toBe("danger");
  });
});

describe("parseSse", () => {
  it("splits complete messages and keeps the remainder", () => {
    const { messages, rest } = parseSse('retry: 2000\n\nevent: state\ndata: {"a":1}\n\n: ping\n\nevent: state\ndata: {"a"');
    expect(messages).toEqual([{ event: "state", data: '{"a":1}' }]);
    expect(rest).toBe('event: state\ndata: {"a"');
  });

  it("joins multi-line data and handles CRLF", () => {
    expect(parseSse("data: one\r\ndata: two\r\n\r\n").messages).toEqual([{ event: "message", data: "one\ntwo" }]);
  });
});

describe("estimateClock", () => {
  it("uses the lowest-latency sample", async () => {
    let t = 1000;
    const rtts = [80, 20, 50];
    const serverAhead = 5000;
    let i = 0;
    const result = await estimateClock(
      async () => {
        const rtt = rtts[i++]!;
        t += rtt / 2;
        const server = t + serverAhead;
        t += rtt / 2;
        return server;
      },
      { samples: 3, now: () => t },
    );
    expect(result).toEqual({ offsetMs: 5000, rttMs: 20, samples: 3 });
  });
});
