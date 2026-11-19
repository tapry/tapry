// A camera that is on but sends black: every iPhone video in a 4K studio was recorded black
// and nobody was told (16 Nov 2026).
import { describe, expect, it } from "vitest";
import { BLACK_AFTER_MS, BLACK_BELOW, BlackWatch } from "../src/lib/client/black-camera";
import { alertAdvice, alertLabel } from "../src/lib/client/quality";

describe("a camera sending black", () => {
  it("counts once it has been black without a break for a while, and clears with the first picture", () => {
    const w = new BlackWatch();
    for (let t = 0; t < BLACK_AFTER_MS; t += 2000) {
      w.add(0, t);
      expect(w.black(t)).toBe(false);
    }
    w.add(3, BLACK_AFTER_MS);
    expect(w.black(BLACK_AFTER_MS)).toBe(true);
    w.add(BLACK_BELOW, BLACK_AFTER_MS + 2000); // a picture again
    expect(w.black(BLACK_AFTER_MS + 2000)).toBe(false);
  });

  it("a dim room is not black, and no picture to judge (camera off, tab hidden) starts over", () => {
    const dim = new BlackWatch();
    for (let t = 0; t <= 60_000; t += 2000) dim.add(40, t);
    expect(dim.black(60_000)).toBe(false);

    const w = new BlackWatch();
    w.add(0, 0);
    w.add(0, 4000);
    w.add(null, 5000);
    w.add(0, 6000);
    expect(w.black(6000 + BLACK_AFTER_MS - 1)).toBe(false);
    expect(w.black(6000 + BLACK_AFTER_MS)).toBe(true);
  });

  it("is named for the host and explained to the person", () => {
    expect(alertLabel("camera_black", null)).toBe("Camera sending black");
    expect(alertAdvice("camera_black", null)).toMatch(/recorded black.*sound is still recorded/);
  });
});
