// The client half of filters: what a device remembers, how the live picture is drawn, and what
// it tells the server. (The server and worker half is in filters.test.ts.)
import type { TrackInfo } from "@tapry/recorder";
import { BRIGHTNESS_VALUES, createTrackBody, NO_FILTERS, type TrackFilters } from "@tapry/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeOutput } from "../src/components/recordings";
import { BACKGROUND_BLUR, canvasFilter, fitSize, kelvinGains, picturePlan, tintColor, TOUCH_UP } from "../src/lib/client/filter-picture";
import { FULL_PACE, MASK, MASK_EDGE, maskLevel, maskPixels, nextPace, SLOW } from "../src/lib/client/person-mask";
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
    expect(parsePrefs(JSON.stringify({ filters: { brightness: 2, look: "cool", touchUp: true, background: "blur", noiseRemoval: true }, mirror: false }))).toEqual({
      filters: { brightness: 2, look: "cool", touchUp: true, background: "blur", noiseRemoval: true },
      mirror: false,
    });
    // Saved before background blur existed: no blur.
    expect(parsePrefs(JSON.stringify({ filters: { brightness: 2, look: "cool", touchUp: true, noiseRemoval: true } })).filters.background).toBe("none");
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

describe("the order a frame is drawn in", () => {
  const blur: TrackFilters = { ...NO_FILTERS, background: "blur" };
  const ops = (f: TrackFilters, hasMask: boolean) => picturePlan(f, 360, hasMask).map((s) => s.op);

  it("is what it was without background blur: the frame, the touch-up, the tint", () => {
    expect(picturePlan(NO_FILTERS, 360, false)).toEqual([{ op: "frame", filter: "none" }]);
    expect(picturePlan(mono, 360, true)).toEqual([{ op: "frame", filter: "saturate(0)" }]); // a mask changes nothing without blur
    expect(picturePlan({ ...NO_FILTERS, look: "warm", touchUp: true }, 360, false)).toEqual([
      { op: "frame", filter: "saturate(1.08)" },
      { op: "soften", of: "frame", filter: `saturate(1.08) blur(${TOUCH_UP.blurPx}px)`, alpha: TOUCH_UP.alpha },
      { op: "tint", color: tintColor({ look: "warm" }) },
    ]);
  });

  it("blurs the background, puts the person over it, then what applies to the whole picture", () => {
    expect(ops({ ...blur, brightness: 1, look: "warm", touchUp: true }, true)).toEqual(["background", "person", "soften", "tint"]);
    const plan = picturePlan({ ...blur, look: "mono", touchUp: true }, 360, true);
    expect(plan).toEqual([
      // The look's colour goes on both layers; only the background is blurred.
      { op: "background", filter: `saturate(0) blur(${BACKGROUND_BLUR.px}px)`, blurPx: BACKGROUND_BLUR.px },
      { op: "person", filter: "saturate(0)", edgePx: BACKGROUND_BLUR.edgePx },
      // Touch-up softens the picture as drawn so far: no colour filter a second time.
      { op: "soften", of: "picture", filter: `blur(${TOUCH_UP.blurPx}px)`, alpha: TOUCH_UP.alpha },
    ]);
    expect(picturePlan(blur, 360, true)).toEqual([
      { op: "background", filter: `blur(${BACKGROUND_BLUR.px}px)`, blurPx: BACKGROUND_BLUR.px },
      { op: "person", filter: "none", edgePx: BACKGROUND_BLUR.edgePx },
    ]);
  });

  it("blurs the whole picture while there is no mask: the room is never shown sharp with blur on", () => {
    expect(ops(blur, false)).toEqual(["background"]);
    expect(ops({ ...blur, look: "cool" }, false)).toEqual(["background", "tint"]);
  });

  it("scales the blur with the picture", () => {
    const [background, person] = picturePlan(blur, 720, true);
    expect(background).toMatchObject({ blurPx: BACKGROUND_BLUR.px * 2, filter: `blur(${BACKGROUND_BLUR.px * 2}px)` });
    expect(person).toMatchObject({ edgePx: BACKGROUND_BLUR.edgePx * 2 });
  });
});

describe("the mask of where the person is", () => {
  it("is black for background, white for the person, with a short smooth step between", () => {
    expect(maskLevel(0)).toBe(0);
    expect(maskLevel(MASK_EDGE.low)).toBe(0);
    expect(maskLevel(0.5)).toBeCloseTo(0.5, 5);
    expect(maskLevel(MASK_EDGE.high)).toBe(1);
    expect(maskLevel(1)).toBe(1);
    expect(maskLevel(0.45)).toBeLessThan(maskLevel(0.55));
  });

  it("becomes white pixels as opaque as the model is sure", () => {
    const out = new Uint8ClampedArray(12);
    maskPixels(new Float32Array([0.05, 0.5, 0.98]), out);
    expect([...out]).toEqual([255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 255, 255]);
  });

  it("is small and slow enough to cost little: about 256x144 at 15 frames a second", () => {
    expect(MASK).toMatchObject({ width: 256, height: 144, frameRate: 15 });
    expect(MASK.bitsPerSecond).toBeLessThanOrEqual(200_000);
  });

  it("slows down once when frames take too long, and gives up if that isn't enough", () => {
    expect(nextPace(FULL_PACE, SLOW.budgetMs - 1)).toBe(FULL_PACE);
    const slower = nextPace(FULL_PACE, SLOW.budgetMs + 20)!;
    expect(slower).toEqual({ intervalMs: FULL_PACE.intervalMs * 2, reduced: true });
    expect(nextPace(slower, SLOW.budgetMs - 1)).toBe(slower); // keeps up at half rate: carries on
    expect(nextPace(slower, SLOW.budgetMs + 20)).toBeNull(); // still too slow: blur goes off
  });
});

describe("registering a track", () => {
  const info = (meta?: Record<string, string>) =>
    ({ sessionId: "ses", trackId: "trk_1", kind: "video", mimeType: "video/webm", startedAt: 1000.4, meta }) as TrackInfo;

  it("carries the filters the person had when it started", () => {
    const filters: TrackFilters = { brightness: 1, look: "mono", touchUp: true, background: "blur", noiseRemoval: true };
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

  it("registers the mask of a blurred background as its own kind of track, picture only", () => {
    const filters: TrackFilters = { ...NO_FILTERS, background: "blur" };
    const mask = { sessionId: "ses", trackId: "trk_mask_0123456789abcdef", kind: "mask", mimeType: "video/webm;codecs=vp8", startedAt: 2000.6, meta: { recordingId: "rec_1", filters: JSON.stringify(filters) } } as TrackInfo;
    const request = trackRequest(mask);
    expect(request).toEqual({ trackId: "trk_mask_0123456789abcdef", recordingId: "rec_1", kind: "mask", mimeType: "video/webm;codecs=vp8", startedAt: 2001, filters });
    expect(createTrackBody.safeParse(request).success).toBe(true);
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
