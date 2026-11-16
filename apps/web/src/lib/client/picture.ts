// Whether someone's picture in the call is still arriving. When a person's connection dies,
// the browser keeps showing their last frame for as long as the call server still lists them
// (up to about 20 s), which looks like a person sitting very still. Counting the frames that
// are actually shown tells a live picture from a stopped one.

/** No new frame for this long: the picture has stopped. Calls run at 24 frames a second. */
export const PICTURE_STALL_MS = 2500;

/** One picture: frame counts in, "stalled" out. Kept apart from the browser so it can be tested. */
export class PictureWatch {
  private frames: number | null = null;
  private lastChange = 0;
  /** The count has moved at least once: only then can it be trusted to say the picture stopped. */
  private counts = false;

  /**
   * `frames`: how many frames the element has shown so far, read at `now`. `watching` false
   * (the tab is hidden: browsers stop painting, so nothing can be told) restarts the wait.
   */
  add(frames: number, now: number, watching = true) {
    if (this.frames !== null && frames !== this.frames) this.counts = true;
    if (this.frames === null || frames !== this.frames || !watching) {
      this.frames = frames;
      this.lastChange = now;
    }
  }

  /**
   * Never true for a picture whose frames were never seen to advance: some browsers (iPhones)
   * don't count the frames of a live picture at all, and a playing picture must not be called
   * interrupted because of that.
   */
  stalled(now: number) {
    return this.counts && now - this.lastChange >= PICTURE_STALL_MS;
  }
}

/**
 * Counts the frames a <video> shows, by every means the browser offers, since none works
 * everywhere: the browser's own callback per frame, and its two frame counters. Any of them
 * moving is a frame. Returns how to read the count and how to stop counting.
 */
export function countFrames(el: HTMLVideoElement): { read: () => number; stop: () => void } {
  type PerFrame = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (id: number) => void };
  const v = el as PerFrame;
  let called = 0;
  let pending: number | undefined;
  let stopped = false;
  const next = () => {
    if (stopped || !v.requestVideoFrameCallback) return;
    pending = v.requestVideoFrameCallback(() => {
      called++;
      next();
    });
  };
  next();
  return {
    read: () => {
      const counted = el.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      const decoded = (el as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount ?? 0;
      return called + counted + decoded;
    },
    stop: () => {
      stopped = true;
      if (pending !== undefined) v.cancelVideoFrameCallback?.(pending);
    },
  };
}
