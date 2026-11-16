// A guest whose connection died used to stay on the host's screen as a frozen last frame, with
// nothing saying the picture had stopped (found in the owner's own test session, 16 Nov 2026).
import { describe, expect, it } from "vitest";
import { PICTURE_STALL_MS, PictureWatch } from "../src/lib/client/picture";

describe("a picture that stopped arriving", () => {
  it("is live while frames keep coming, stalled once none has for a while, live again when they return", () => {
    const w = new PictureWatch();
    let frames = 0;
    for (let t = 0; t <= 5000; t += 500) w.add((frames += 12), t);
    expect(w.stalled(5000)).toBe(false);

    for (let t = 5500; t < 5000 + PICTURE_STALL_MS; t += 500) {
      w.add(frames, t);
      expect(w.stalled(t)).toBe(false); // a short hiccup isn't a stopped picture
    }
    w.add(frames, 5000 + PICTURE_STALL_MS);
    expect(w.stalled(5000 + PICTURE_STALL_MS)).toBe(true);

    w.add(frames + 1, 9000);
    expect(w.stalled(9000)).toBe(false);
  });

  it("says nothing before it has looked once", () => {
    expect(new PictureWatch().stalled(60_000)).toBe(false);
  });

  // An iPhone showed "Picture interrupted" over a host whose picture was playing: its browser
  // doesn't count a live picture's frames, so the count never moved (owner's test, 16 Nov 2026).
  it("never calls a picture stalled when its frame count has never moved", () => {
    const w = new PictureWatch();
    for (let t = 0; t <= 60_000; t += 500) w.add(0, t);
    expect(w.stalled(60_000)).toBe(false);
  });

  it("doesn't call a picture stalled because the tab was hidden", () => {
    const w = new PictureWatch();
    w.add(90, 0);
    w.add(100, 0);
    for (let t = 500; t <= 20_000; t += 500) w.add(100, t, false); // hidden: the browser paints nothing
    expect(w.stalled(20_000)).toBe(false);
    w.add(100, 20_500); // visible again and still no frame
    expect(w.stalled(20_500)).toBe(false);
    w.add(100, 20_000 + PICTURE_STALL_MS);
    expect(w.stalled(20_000 + PICTURE_STALL_MS)).toBe(true);
  });
});
