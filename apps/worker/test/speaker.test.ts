// The combined video that follows the speaker: who talks when, and which stretches go full frame.
import { describe, expect, it } from "vitest";
import { speakerShots, speechFromSilence, SHOTS, type Interval } from "../src/speaker.js";

const speech = (o: Record<string, Interval[]>) => new Map(Object.entries(o));
const all = (...ids: string[]) => new Set(ids);

describe("when someone talks, from the pauses ffmpeg reports", () => {
  it("is everything between the pauses, in whatever order the two reports arrive", () => {
    const report = [
      "frame:23 pts:1 pts_time:0.98", "lavfi.silence_end=1.02",
      "frame:140 pts:2 pts_time:5.97", "lavfi.silence_end=6.01",
      "frame:8 pts:3 pts_time:0.34", "lavfi.silence_start=0",
      "frame:78 pts:4 pts_time:3.3", "lavfi.silence_start=3.02",
      "frame:207 pts:5 pts_time:8.8", "lavfi.silence_start=8.52",
    ].join("\n");
    expect(speechFromSilence(report, 10)).toEqual([[1.02, 3.02], [6.01, 8.52]]);
  });

  it("is the whole recording when there is no pause, and nothing when it is all pause", () => {
    expect(speechFromSilence("", 12)).toEqual([[0, 12]]);
    expect(speechFromSilence("lavfi.silence_start=0", 12)).toEqual([]);
    // Talking from the start, then quiet to the end.
    expect(speechFromSilence("lavfi.silence_start=4.5", 12)).toEqual([[0, 4.5]]);
  });
});

describe("following the speaker", () => {
  it("goes to whoever has the floor, from when they began, and back to everyone in a long silence", () => {
    const shots = speakerShots(speech({ host: [[1, 9]], guest: [[20, 30]] }), 40, all("host", "guest"));
    expect(shots.map((s) => [s.id, s.start])).toEqual([["host", 1], ["guest", 20]]);
    // Held for a moment after their last word (to the nearest step), then the grid.
    expect(shots[0]!.end).toBeCloseTo(9 + SHOTS.gapS, 0);
    expect(shots[1]!.end).toBeCloseTo(30 + SHOTS.gapS, 0);
    expect(shots[0]!.end).toBeLessThan(20);
  });

  it("hands over without a gap when one answers the other", () => {
    const shots = speakerShots(speech({ host: [[0, 6]], guest: [[6.4, 15]] }), 15, all("host", "guest"));
    expect(shots).toEqual([{ id: "host", start: 0, end: 6.4 }, { id: "guest", start: 6.4, end: 15 }]);
  });

  it("isn't taken away by a breath or a short word from someone else", () => {
    const shots = speakerShots(speech({ host: [[0, 5], [5.8, 12]], guest: [[7, 7.6]] }), 12, all("host", "guest"));
    expect(shots).toEqual([{ id: "host", start: 0, end: 12 }]);
  });

  it("shows everyone while two talk over each other, and never a shot too short to read", () => {
    const shots = speakerShots(speech({ host: [[0, 4], [6, 14]], guest: [[6, 14], [15, 15.8]] }), 20, all("host", "guest"));
    // The host's opening line; then both for eight seconds (the grid); the guest's last word is too short to take the picture.
    expect(shots.map((s) => s.id)).toEqual(["host"]);
    expect(shots[0]!.start).toBe(0);
    expect(shots[0]!.end).toBeLessThanOrEqual(6);
    for (const s of shots) expect(s.end - s.start).toBeGreaterThanOrEqual(SHOTS.minShotS);
  });

  it("keeps the grid while someone without a camera has the floor, and with one person or none", () => {
    const talk = speech({ host: [[0, 8]], guest: [[9, 20]] });
    expect(speakerShots(talk, 20, all("guest")).map((s) => s.id)).toEqual(["guest"]);
    expect(speakerShots(talk, 20, all())).toEqual([]);
    expect(speakerShots(speech({ host: [[0, 8]] }), 20, all("host"))).toEqual([]);
    expect(speakerShots(speech({ host: [], guest: [] }), 20, all("host", "guest"))).toEqual([]);
  });

  it("never overlaps shots or runs past the end", () => {
    const talk = speech({ a: [[0, 3], [10, 18], [30, 31]], b: [[3.2, 9], [18.5, 29]], c: [[12, 13], [29.5, 40]] });
    const shots = speakerShots(talk, 40, all("a", "b", "c"));
    expect(shots.length).toBeGreaterThanOrEqual(4);
    for (const [i, s] of shots.entries()) {
      expect(s.start).toBeLessThan(s.end);
      expect(s.end).toBeLessThanOrEqual(40);
      if (i > 0) expect(s.start).toBeGreaterThanOrEqual(shots[i - 1]!.end - 1e-6);
    }
  });
});
