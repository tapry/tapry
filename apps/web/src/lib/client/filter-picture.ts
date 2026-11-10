"use client";

import { BRIGHTNESS_VALUES, LOOK_VALUES, type TrackFilters } from "@tapry/shared";

// The live picture with someone's filters, drawn on a canvas: for the call's copy of the camera
// and for the person's own preview. Never for the recorder, which keeps the untouched camera;
// the worker applies the same numbers to the finished files with ffmpeg.
//
// How the shared numbers (ffmpeg `eq` units, kelvin) become canvas operations:
//  - brightness + gamma → one CSS `brightness(k)`. ffmpeg adds light (`brightness`, on 0..1) and
//    lifts shadows (`gamma`: out = in^(1/gamma)); CSS only multiplies. k is chosen so mid-grey
//    lands where ffmpeg puts it: k = (0.5^(1/gamma) + brightness) / 0.5. Highlights come out a
//    little brighter and shadows a little darker than in the file.
//  - contrast → CSS `contrast(c)`: the same formula as ffmpeg's (around mid-grey).
//  - saturation → CSS `saturate(s)`: 0 is black and white in both.
//  - temperature → a white-balance gain per colour channel (kelvin to RGB by the usual
//    black-body fit, relative to 6500 K, largest channel kept at 1), painted over the frame with
//    the "multiply" blend. Warm takes out blue, cool takes out red.
//  - touch-up → the same frame drawn again, blurred, at part strength: a cheap softening, no
//    face detection. The file's version is whatever the worker does; this is its likeness.

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The `CanvasRenderingContext2D.filter` string for these filters ("none" when the picture is as it is). */
export function canvasFilter(f: Pick<TrackFilters, "brightness" | "look">): string {
  const b = BRIGHTNESS_VALUES[f.brightness];
  const look = LOOK_VALUES[f.look];
  const parts: string[] = [];
  const k = (Math.pow(0.5, 1 / b.gamma) + b.brightness) / 0.5;
  if (round(k) !== 1) parts.push(`brightness(${round(k)})`);
  if (b.contrast !== 1) parts.push(`contrast(${round(b.contrast)})`);
  if (look.saturation !== 1) parts.push(`saturate(${round(look.saturation)})`);
  return parts.join(" ") || "none";
}

/** Red, green and blue of a black body at this temperature, 0..255 (Tanner Helland's fit). */
function kelvinRgb(kelvin: number): [number, number, number] {
  const t = Math.min(40_000, Math.max(1000, kelvin)) / 100;
  const clamp = (n: number) => Math.min(255, Math.max(0, n));
  const r = t <= 66 ? 255 : clamp(329.698727446 * Math.pow(t - 60, -0.1332047592));
  const g = t <= 66 ? clamp(99.4708025861 * Math.log(t) - 161.1195681661) : clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return [r, g, b];
}

/** Per-channel gains (0..1, the largest is 1) that move a 6500 K picture to this temperature. */
export function kelvinGains(kelvin: number): [number, number, number] {
  const to = kelvinRgb(kelvin);
  const from = kelvinRgb(6500);
  const gains = to.map((v, i) => v / from[i]!) as [number, number, number];
  const max = Math.max(...gains);
  return gains.map((g) => round(g / max)) as [number, number, number];
}

/** The colour multiplied over the frame for the look's temperature; null when it is neutral. */
export function tintColor(f: Pick<TrackFilters, "look">): string | null {
  const { temperature } = LOOK_VALUES[f.look];
  if (temperature === 6500) return null;
  const [r, g, b] = kelvinGains(temperature);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** Touch-up: blur radius for a 360-line picture, and how much of the blurred frame goes on top. */
export const TOUCH_UP = { blurPx: 3, alpha: 0.4 };

/** Older Safari has no `ctx.filter`: there, the live picture is left alone (files still get the filters). */
export function canPreviewFilters(): boolean {
  return typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;
}

/** One frame of `source` with the filters, filling the canvas. */
export function drawFiltered(ctx: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number, f: TrackFilters) {
  const base = canvasFilter(f);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = base;
  ctx.drawImage(source, 0, 0, width, height);
  if (f.touchUp) {
    const blur = `blur(${round((TOUCH_UP.blurPx * height) / 360)}px)`;
    ctx.filter = base === "none" ? blur : `${base} ${blur}`;
    ctx.globalAlpha = TOUCH_UP.alpha;
    ctx.drawImage(source, 0, 0, width, height);
    ctx.globalAlpha = 1;
  }
  ctx.filter = "none";
  const tint = tintColor(f);
  if (tint) {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
  }
}

/** The canvas size for a picture: at most `maxHeight` lines, the source's shape, even numbers. */
export function fitSize(sourceWidth: number, sourceHeight: number, maxHeight: number) {
  if (!sourceWidth || !sourceHeight) return { width: 0, height: 0 };
  const scale = Math.min(1, maxHeight / sourceHeight);
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(sourceWidth), height: even(sourceHeight) };
}

/**
 * Calls `draw` for each new frame of `video`: with requestVideoFrameCallback where the browser
 * has it, else a timer at `frameRate`. A hidden tab gets no video-frame callbacks, so there the
 * timer takes over when `whileHidden` (the call: the others should still see this person), or
 * the work pauses (a preview nobody is looking at). Returns how to stop.
 */
export function onEachFrame(video: HTMLVideoElement, frameRate: number, draw: () => void, whileHidden: boolean) {
  const hasFrameCallback = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
  let handle = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  const onFrame = () => {
    if (stopped) return;
    draw();
    handle = video.requestVideoFrameCallback(onFrame);
  };
  const halt = () => {
    if (handle) video.cancelVideoFrameCallback(handle);
    handle = 0;
    clearInterval(timer);
    timer = undefined;
  };
  const start = () => {
    halt();
    if (stopped) return;
    const hidden = document.visibilityState === "hidden";
    if (hidden && !whileHidden) return;
    if (hasFrameCallback && !hidden) handle = video.requestVideoFrameCallback(onFrame);
    else timer = setInterval(draw, 1000 / frameRate);
  };
  document.addEventListener("visibilitychange", start);
  start();

  return () => {
    stopped = true;
    halt();
    document.removeEventListener("visibilitychange", start);
  };
}

export interface FilteredTrack {
  /** The picture with the filters: what the call sends instead of the plain copy. */
  track: MediaStreamTrack;
  setFilters(filters: TrackFilters): void;
  /** Stops the drawing and the canvas's track. The source track is the caller's to stop. */
  stop(): void;
}

/**
 * A video track showing `source` with the filters. `source` must be the call's own copy of the
 * camera, never the track the recorder uses: it is only read here, but it is the caller's copy
 * that gets sized for the call.
 */
export function startFilteredTrack(
  source: MediaStreamTrack,
  opts: { maxHeight: number; frameRate: number; filters: TrackFilters },
): FilteredTrack {
  let filters = opts.filters;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([source]);
  void video.play().catch(() => {});

  const canvas = document.createElement("canvas");
  const settings = source.getSettings();
  const first = fitSize(settings.width ?? 640, settings.height ?? 360, opts.maxHeight);
  canvas.width = first.width;
  canvas.height = first.height;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillRect(0, 0, canvas.width, canvas.height); // black until the first frame, like a camera starting
  const track = canvas.captureStream(opts.frameRate).getVideoTracks()[0]!;

  const draw = () => {
    // Camera off in the call: the track is disabled, so nothing would be sent anyway.
    if (!track.enabled || video.readyState < 2) return;
    const size = fitSize(video.videoWidth, video.videoHeight, opts.maxHeight);
    if (!size.width) return;
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    drawFiltered(ctx, video, canvas.width, canvas.height, filters);
  };
  let stopLoop = onEachFrame(video, opts.frameRate, draw, true);

  const stop = () => {
    stopLoop();
    stopLoop = () => {};
    source.removeEventListener("ended", stop);
    track.stop();
    video.pause();
    video.srcObject = null;
  };
  // The camera went away (unplugged): nothing more to draw.
  source.addEventListener("ended", stop);

  return {
    track,
    setFilters(next) {
      filters = next;
    },
    stop,
  };
}
