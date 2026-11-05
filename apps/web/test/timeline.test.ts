import { describe, expect, it } from "vitest";
import { describeProgress, timelineSteps } from "../src/components/recording-timeline";
import type { RecordingSummary } from "../src/server/processing";

const T = Date.UTC(2026, 10, 2, 14, 0);
const recording = (over: Partial<RecordingSummary> = {}): RecordingSummary => ({
  id: "rec_1",
  number: 1,
  sessionId: "ses_1",
  status: "stopped",
  processing: "pending",
  processingError: null,
  transcript: "off",
  startedAt: T - 30 * 60_000,
  stoppedAt: T,
  uploadedAt: null,
  processingStartedAt: null,
  processedAt: null,
  transcribedAt: null,
  progress: null,
  tracks: 2,
  incompleteTracks: 0,
  bytes: 0,
  rawDeleted: false,
  people: [
    { participantId: "p1", name: "Host", role: "host", tracks: 1, completeTracks: 1, bytes: 0 },
    { participantId: "p2", name: "Sam", role: "guest", tracks: 1, completeTracks: 1, bytes: 0 },
  ],
  outputs: [],
  ...over,
});
const states = (e: RecordingSummary) => timelineSteps(e, T + 10 * 60_000, true).map((s) => `${s.key}:${s.state}`);

describe("processing timeline", () => {
  it("waits for a guest's upload, naming them", () => {
    const e = recording({ incompleteTracks: 1, people: [recording().people[0]!, { ...recording().people[1]!, completeTracks: 0 }] });
    expect(states(e)).toEqual(["recorded:done", "uploaded:current", "files:todo"]);
    expect(timelineSteps(e, T, true)[1]!.detail).toBe("Waiting for Sam");
  });

  it("shows the running job's step and how far it is", () => {
    const e = recording({
      uploadedAt: T + 60_000,
      processing: "processing",
      processingStartedAt: T + 60_000,
      progress: { stage: "rendering", done: 2, total: 5, current: "Sam's audio" },
    });
    expect(states(e)).toEqual(["recorded:done", "uploaded:done", "files:current"]);
    const files = timelineSteps(e, T + 4 * 60_000, true)[2]!;
    expect(files.detail).toBe("Making Sam's audio (3 of 5) · 3 min so far");
    expect(files.fraction).toBeCloseTo(0.1 + 0.8 * (2 / 5));
  });

  it("says how long the files and the transcript took, once done", () => {
    const e = recording({
      uploadedAt: T + 60_000,
      processing: "ready",
      processingStartedAt: T + 60_000,
      processedAt: T + 5 * 60_000,
      transcript: "ready",
      transcribedAt: T + 9 * 60_000,
    });
    const steps = timelineSteps(e, T + 10 * 60_000, true);
    expect(states(e)).toEqual(["recorded:done", "uploaded:done", "files:done", "transcript:done"]);
    expect(steps[2]!.detail).toMatch(/took 4 min$/);
    expect(steps[3]!.detail).toMatch(/took 4 min$/);
  });

  it("marks finishing without someone, and failures", () => {
    const missing = { ...recording().people[1]!, completeTracks: 0 };
    const forced = recording({ processing: "failed", processingError: "Processing failed.", people: [recording().people[0]!, missing] });
    expect(states(forced)).toEqual(["recorded:done", "uploaded:skipped", "files:failed"]);
    expect(timelineSteps(forced, T, true)[1]!.detail).toBe("Missing: Sam");
    const noTranscript = recording({ uploadedAt: T, processing: "ready", processedAt: T, transcript: "failed" });
    expect(states(noTranscript).at(-1)).toBe("transcript:failed");
  });

  it("spreads one job's stages over a single bar", () => {
    expect(describeProgress({ stage: "collecting", done: 0, total: 4, current: "Sam" })).toEqual({ text: "Collecting the uploads (Sam)", fraction: 0 });
    expect(describeProgress({ stage: "saving", done: 3, total: 6, current: null }).fraction).toBeCloseTo(0.95);
    expect(describeProgress({ stage: "transcribing", done: 1, total: 2, current: "Sam" }).text).toBe("Transcribing Sam (2 of 2)");
  });
});
