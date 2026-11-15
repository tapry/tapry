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

  /**
   * `frames`: how many frames the element has shown so far, read at `now`. `watching` false
   * (the tab is hidden: browsers stop painting, so nothing can be told) restarts the wait.
   */
  add(frames: number, now: number, watching = true) {
    if (this.frames === null || frames !== this.frames || !watching) {
      this.frames = frames;
      this.lastChange = now;
    }
  }

  stalled(now: number) {
    return this.frames !== null && now - this.lastChange >= PICTURE_STALL_MS;
  }
}

/** Frames this <video> has shown so far (falls back to its clock where the count isn't offered). */
export function framesShown(el: HTMLVideoElement): number {
  const q = el.getVideoPlaybackQuality?.();
  if (q) return q.totalVideoFrames;
  const webkit = (el as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount;
  return webkit ?? el.currentTime;
}
