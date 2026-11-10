// The client half of filters: what a device remembers, how the live picture is drawn, and what
// it tells the server. (The server and worker half is in filters.test.ts.)
import type { TrackInfo } from "@tapry/recorder";
import { BRIGHTNESS_VALUES, NO_FILTERS, type TrackFilters } from "@tapry/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeOutput } from "../src/components/recordings";
import { canvasFilter, fitSize, kelvinGains, tintColor } from "../src/lib/client/filter-picture";
import {
  createFilterSync,
  DEFAULT_PREFS,
  FILTERS_KEY,
  getFilterPrefs,
  parseFilters,
  parsePrefs,
  reloadFilterPrefs,
  setFilterPrefs,
} from "../src/lib/client/filters";
import { trackRequest } from "../src/lib/client/recording";

const mono: TrackFilters = { ...NO_FILTERS, look: "mono" };

describe("a person's filters, as kept on their device", () => {
  it("are none, with the own view mirrored, when nothing is stored or it can't be read", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("null")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('"warm"')).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toEqual({ filters: NO_FILTERS, mirror: true });
  });

  it("read what was stored, filling in what an older version didn't have", () => {
    expect(parsePrefs(JSON.stringify({ filters: { brightness: 2, look: "cool", touchUp: true, noiseRemoval: true }, mirror: false }))).toEqual({
      filters: { brightness: 2, look: "cool", touchUp: true, noiseRemoval: true },
      mirror: false,
    });
    expect(parsePrefs(JSON.stringify({ filters: { look: "warm" } }))).toEqual({ filters: { ...NO_FILTERS, look: "warm" }, mirror: true });
    expect(parsePrefs(JSON.stringify({ mirror: false }))).toEqual({ filters: NO_FILTERS, mirror: false });
  });

  it("drop filters that aren't ours (never a half-understood choice), keeping the mirror", () => {
    expect(parsePrefs(JSON.stringify({ filters: { brightness: 7, look: "mono" }, mirror: false }))).toEqual({ filters: NO_FILTERS, mirror: false });
    expect(parsePrefs(JSON.stringify({ filters: "mono", mirror: "yes" }))).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ filters: { look: "sepia" } })).filters).toEqual(NO_FILTERS);
  });

  describe("in localStorage", () => {
    let stored: Map<string, string>;
    beforeEach(() => {
      stored = new Map();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => stored.get(k) ?? null,
        setItem: (k: string, v: string) => void stored.set(k, v),
      });
      reloadFilterPrefs();
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      reloadFilterPrefs();
    });

    it("are saved next to the device choices and found again by the next page", () => {
      expect(getFilterPrefs()).toEqual(DEFAULT_PREFS);
      setFilterPrefs({ filters: mono, mirror: false });
      expect(FILTERS_KEY).toBe("opentake:filters");
      expect(JSON.parse(stored.get(FILTERS_KEY)!)).toEqual({ filters: mono, mirror: false });
      reloadFilterPrefs(); // a new page
      expect(getFilterPrefs()).toEqual({ filters: mono, mirror: false });
    });

    it("survive storage that throws: the choice holds for this page only", () => {
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      });
      reloadFilterPrefs();
      expect(getFilterPrefs()).toEqual(DEFAULT_PREFS);
      setFilterPrefs({ filters: mono, mirror: true });
      expect(getFilterPrefs().filters).toEqual(mono);
    });
  });
});

describe("the live picture's canvas filter", () => {
  const number = (s: string, fn: string) => Number(new RegExp(`${fn}\\(([\\d.]+)\\)`).exec(s)?.[1] ?? "NaN");

  it("is nothing when the picture is as it is (touch-up and noise removal aren't colour)", () => {
    const softOnly: TrackFilters = { ...NO_FILTERS, touchUp: true, noiseRemoval: true };
    expect(canvasFilter(NO_FILTERS)).toBe("none");
    expect(canvasFilter(softOnly)).toBe("none");
    expect(tintColor(NO_FILTERS)).toBeNull();
  });

  it("black and white is zero saturation, without a tint", () => {
    expect(canvasFilter(mono)).toBe("saturate(0)");
    expect(tintColor(mono)).toBeNull();
  });

  it("brightness puts mid-grey where ffmpeg's eq does (gamma, then added light), with its contrast", () => {
    for (const level of [1, 2] as const) {
      const v = BRIGHTNESS_VALUES[level];
      const s = canvasFilter({ brightness: level, look: "none" });
      expect(number(s, "brightness") * 0.5).toBeCloseTo(Math.pow(0.5, 1 / v.gamma) + v.brightness, 2);
      expect(number(s, "contrast")).toBe(v.contrast);
      expect(s).not.toContain("saturate");
    }
    expect(number(canvasFilter({ brightness: 2, look: "none" }), "brightness")).toBeGreaterThan(number(canvasFilter({ brightness: 1, look: "none" }), "brightness"));
  });

  it("combines brightness and look in one string", () => {
    expect(canvasFilter({ brightness: 1, look: "warm" })).toMatch(/^brightness\([\d.]+\) contrast\(1\.03\) saturate\(1\.08\)$/);
  });

  it("warm takes out blue, cool takes out red, and 6500 K changes nothing", () => {
    expect(kelvinGains(6500)).toEqual([1, 1, 1]);
    const [wr, wg, wb] = kelvinGains(5200);
    expect(wr).toBe(1);
    expect(wb).toBeLessThan(wg);
    expect(wg).toBeLessThan(1);
    expect(wb).toBeGreaterThan(0.7); // a tint, not a colour cast
    const [cr, cg, cb] = kelvinGains(8200);
    expect(cb).toBe(1);
    expect(cr).toBeLessThan(cg);
    expect(cr).toBeGreaterThan(0.7);
    expect(tintColor({ look: "warm" })).toMatch(/^rgb\(255 \d+ \d+\)$/);
    expect(tintColor({ look: "cool" })).toMatch(/^rgb\(\d+ \d+ 255\)$/);
  });

  it("is drawn at the call's size, in the camera's shape", () => {
    expect(fitSize(1920, 1080, 360)).toEqual({ width: 640, height: 360 });
    expect(fitSize(640, 480, 360)).toEqual({ width: 480, height: 360 });
    expect(fitSize(320, 240, 360)).toEqual({ width: 320, height: 240 }); // never scaled up
    expect(fitSize(0, 0, 360)).toEqual({ width: 0, height: 0 }); // no frame yet
  });
});

describe("registering a track", () => {
  const info = (meta?: Record<string, string>) =>
    ({ sessionId: "ses", trackId: "trk_1", kind: "video", mimeType: "video/webm", startedAt: 1000.4, meta }) as TrackInfo;

  it("carries the filters the person had when it started", () => {
    const filters: TrackFilters = { brightness: 1, look: "mono", touchUp: true, noiseRemoval: true };
    expect(trackRequest(info({ recordingId: "rec_1", filters: JSON.stringify(filters) }))).toEqual({
      trackId: "trk_1",
      recordingId: "rec_1",
      kind: "video",
      mimeType: "video/webm",
      startedAt: 1000,
      filters,
    });
    expect(trackRequest(info({ recordingId: "rec_1", filters: JSON.stringify(NO_FILTERS) })).filters).toEqual(NO_FILTERS);
  });

  it("leaves them out for a track from before filters, or one whose note can't be read", () => {
    expect(trackRequest(info({ recordingId: "rec_1" }))).toEqual({
      trackId: "trk_1",
      recordingId: "rec_1",
      kind: "video",
      mimeType: "video/webm",
      startedAt: 1000,
    });
    expect("filters" in trackRequest(info({ recordingId: "rec_1", filters: "{broken" }))).toBe(false);
    expect(parseFilters(JSON.stringify({ look: "sepia" }))).toBeUndefined();
  });
});

describe("telling the server about a change of filters", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const ticket = { sessionId: "ses", token: "tok" };

  it("waits for the person to settle, and sends only the last choice", async () => {
    const put = vi.fn(async () => {});
    const sync = createFilterSync(ticket, NO_FILTERS, { put });
    sync.set({ ...NO_FILTERS, look: "warm" });
    await vi.advanceTimersByTimeAsync(300);
    sync.set(mono);
    await vi.advanceTimersByTimeAsync(300);
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(put.mock.calls).toEqual([[mono]]);
  });

  it("sends nothing when the choice is back where the server has it", async () => {
    const put = vi.fn(async () => {});
    const sync = createFilterSync(ticket, NO_FILTERS, { put });
    sync.set(mono);
    sync.set(NO_FILTERS);
    await vi.advanceTimersByTimeAsync(1000);
    expect(put).not.toHaveBeenCalled();
  });

  it("swallows a failed send and sends again with the next change, even back to the first choice", async () => {
    const put = vi.fn<(f: TrackFilters) => Promise<void>>(async () => {});
    put.mockRejectedValueOnce(new Error("offline"));
    const sync = createFilterSync(ticket, NO_FILTERS, { put });
    sync.set(mono);
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledTimes(1);
    // The server may or may not have it: the next change goes whatever it is.
    sync.set(NO_FILTERS);
    await vi.advanceTimersByTimeAsync(500);
    expect(put.mock.calls).toEqual([[mono], [NO_FILTERS]]);
  });

  it("sends the choice again when a track registers with older filters (it missed the change)", async () => {
    const put = vi.fn(async () => {});
    const sync = createFilterSync(ticket, NO_FILTERS, { put });
    sync.set(mono);
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledTimes(1);
    sync.registered(mono); // registered with the current choice: nothing to add
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledTimes(1);
    sync.registered(NO_FILTERS); // started before the change, reached the server after it
    await vi.advanceTimersByTimeAsync(10);
    expect(put.mock.calls).toEqual([[mono], [mono]]);
    sync.registered(undefined); // a track without filters counts as none
    await vi.advanceTimersByTimeAsync(10);
    expect(put).toHaveBeenCalledTimes(3);
  });

  it("stops with the session", async () => {
    const put = vi.fn(async () => {});
    const sync = createFilterSync(ticket, NO_FILTERS, { put });
    sync.set(mono);
    sync.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("a person's sound before noise removal", () => {
  const output = (fileName: string) => ({ id: "out", kind: "audio", fileName, bytes: 1, durationMs: 1 }) as Parameters<typeof describeOutput>[0];

  it("is titled like their audio, marked as the original", () => {
    expect(describeOutput(output("Sam Guest - audio (original).wav"))).toMatchObject({ title: "Sam Guest's audio (original)", icon: "wave", format: "WAV" });
    expect(describeOutput(output("Sam Guest - audio (original).flac")).title).toBe("Sam Guest's audio (original)");
    expect(describeOutput(output("Sam Guest - audio.wav")).title).toBe("Sam Guest's audio");
  });
});
