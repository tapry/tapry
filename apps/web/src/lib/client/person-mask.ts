"use client";

import { needsMask } from "@tapry/shared";
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { useEffect, useState } from "react";
import { canPreviewFilters, onEachFrame } from "./filter-picture";
import { getFilterPrefs, setFilterPrefs, type FilterPrefs } from "./filters";

// Where the person is in their camera picture, for background blur. Worked out on this device
// (MediaPipe's selfie segmenter, running in WebAssembly; the runtime and the model are served by
// this server, nothing is fetched from anywhere else and no picture leaves the device for it).
//
// It reads its own copy (a clone) of the camera track, scaled down; the track the recorder uses
// is never constrained, stopped or drawn through anything. Out of it come two small canvases:
//  - `alpha`: the person opaque, the rest transparent, for the live picture (filter-picture.ts);
//  - `grey`: white where the person is, black elsewhere. Its captureStream is what gets recorded
//    as the "mask" track, from which the worker blurs the background of the finished video.
//
// The mask may only ever help: whatever goes wrong here (no WebAssembly, the model won't load,
// the device is too slow), blur is turned off and the person is told. The recording goes on.

/** The recorded mask: small, and slower than the camera (the worker holds each frame until the next). */
export const MASK = { width: 256, height: 144, frameRate: 15, bitsPerSecond: 150_000 };
/** What the segmenter reads: the camera at the call's size. */
const SOURCE = { width: 640, height: 360 };
/** The selfie model works on a 256x256 picture. */
const MODEL_SIZE = 256;

const WASM_PATH = "/mediapipe";
const MODEL_PATH = "/models/selfie_segmenter.tflite";

export type MaskState = "loading" | "ready" | "unsupported" | "failed" | "slow";

/** Can this browser do background blur at all? */
export function maskSupported(): boolean {
  return (
    typeof WebAssembly === "object" &&
    canPreviewFilters() &&
    typeof HTMLCanvasElement !== "undefined" &&
    "captureStream" in HTMLCanvasElement.prototype
  );
}

// ── How sure the model is → how much of the person shows ─────────────────────

/**
 * Below `low` it's background, above `high` it's the person; a smooth step between (0..1).
 * Set a little on the sure side: where the model hesitates (the rim round hair and shoulders,
 * which is mostly background) the picture is blurred, so no sharp band of the room shows
 * round the person.
 */
export const MASK_EDGE = { low: 0.4, high: 0.7 };

export function maskLevel(confidence: number): number {
  const t = Math.min(1, Math.max(0, (confidence - MASK_EDGE.low) / (MASK_EDGE.high - MASK_EDGE.low)));
  return t * t * (3 - 2 * t);
}

/**
 * The model answers each frame on its own, so a still edge shimmers from frame to frame. A
 * small change moves only part of the way (`follow`) toward the new answer; a big one (someone
 * moved: `jump`) is taken at once, so the outline never trails behind a hand or a turning head.
 */
export const STEADY = { follow: 0.55, jump: 0.3 };

/** This frame's answer steadied against the last one shown. `out` may be `previous`. */
export function steadyMask(previous: Float32Array | null, current: Float32Array, out: Float32Array) {
  if (!previous || previous.length !== current.length) return void out.set(current);
  for (let i = 0; i < current.length; i++) {
    const change = current[i]! - previous[i]!;
    out[i] = Math.abs(change) > STEADY.jump ? current[i]! : previous[i]! + change * STEADY.follow;
  }
}

/** The model's answer for each pixel (0..1: how sure it is of a person) as white pixels of that opacity. */
export function maskPixels(confidence: Float32Array, out: Uint8ClampedArray) {
  for (let i = 0, p = 0; i < confidence.length; i++, p += 4) {
    out[p] = out[p + 1] = out[p + 2] = 255;
    out[p + 3] = Math.round(maskLevel(confidence[i]!) * 255);
  }
}

// ── Keeping up ───────────────────────────────────────────────────────────────

/** A frame should take no longer than this, on average over a few seconds. */
export const SLOW = { budgetMs: 80, windowMs: 3000, minSamples: 6, warmUpFrames: 5 };

export interface Pace {
  /** Time between segmentations. */
  intervalMs: number;
  /** Already slowed down once. */
  reduced: boolean;
}

export const FULL_PACE: Pace = { intervalMs: 1000 / MASK.frameRate, reduced: false };

/**
 * After a few seconds of frames that took `averageMs` each: carry on, segment half as often,
 * or (already at half, and still too slow) give up. null means give up.
 */
export function nextPace(pace: Pace, averageMs: number): Pace | null {
  if (averageMs <= SLOW.budgetMs) return pace;
  return pace.reduced ? null : { intervalMs: pace.intervalMs * 2, reduced: true };
}

// ── The model: loaded once per page, the first time blur is turned on ────────

type Delegate = "GPU" | "CPU";
let loaded: Promise<{ segmenter: ImageSegmenter; delegate: Delegate }> | undefined;

async function createSegmenter(only?: Delegate) {
  const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
  const files = await FilesetResolver.forVisionTasks(WASM_PATH);
  const make = (delegate: Delegate) =>
    ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  if (only) return { segmenter: await make(only), delegate: only };
  try {
    return { segmenter: await make("GPU"), delegate: "GPU" as Delegate };
  } catch {
    return { segmenter: await make("CPU"), delegate: "CPU" as Delegate };
  }
}

function loadSegmenter() {
  loaded ??= createSegmenter().catch((err) => {
    loaded = undefined; // turning blur on again tries again
    throw err;
  });
  return loaded;
}

/** The graphics card's version failed on a frame: the same model on the processor instead. */
function reloadOnCpu() {
  const previous = loaded;
  loaded = createSegmenter("CPU").catch((err) => {
    loaded = undefined;
    throw err;
  });
  void previous?.then(({ segmenter }) => segmenter.close()).catch(() => {});
  return loaded;
}

// ── The running mask ─────────────────────────────────────────────────────────

/** A mask older than this isn't used: the picture is blurred whole instead. */
const STALE_MS = 1000;
let live: { alpha: HTMLCanvasElement; at: number } | null = null;

/** Where the person is right now (opaque there), or null when not known: draw the whole picture blurred. */
export function getPersonMask(): HTMLCanvasElement | null {
  return live && performance.now() - live.at < STALE_MS ? live.alpha : null;
}

export interface PersonMask {
  /** The mask as a video track to record (white: person). Null until the first mask is made. */
  stream(): MediaStream | null;
  stop(): void;
}

/**
 * Starts working out where the person is, from a copy of `camera`. `onState` hears "loading",
 * then "ready" with the first mask, or the reason it can't be done.
 */
export function startPersonMask(camera: MediaStreamTrack, onState: (state: MaskState) => void): PersonMask {
  let stopped = false;
  let stream: MediaStream | null = null;
  let stopLoop = () => {};
  const clone = camera.clone(); // never the recorder's track itself
  clone.enabled = true;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;

  const canvas = (width: number, height: number) => Object.assign(document.createElement("canvas"), { width, height });
  const grey = canvas(MASK.width, MASK.height);
  const alpha = canvas(MASK.width, MASK.height);
  // What the model is given: the frame squeezed to the model's own square size, whatever the
  // camera copy's size is (some browsers don't scale a copy down), so every frame costs the same.
  const input = canvas(MODEL_SIZE, MODEL_SIZE);
  const inputCtx = input.getContext("2d", { alpha: false })!;
  const stage = canvas(1, 1); // the model's answer (square), before it's put back in the camera's shape
  const greyCtx = grey.getContext("2d", { alpha: false })!;
  const alphaCtx = alpha.getContext("2d")!;
  const stageCtx = stage.getContext("2d")!;
  let pixels: ImageData | null = null;
  let steady: Float32Array | null = null; // the last answer shown, for steadyMask
  greyCtx.fillRect(0, 0, grey.width, grey.height);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopLoop();
    if (live?.alpha === alpha) live = null;
    stream?.getTracks().forEach((t) => t.stop());
    clone.stop();
    video.pause();
    video.srcObject = null;
  };
  const fail = (state: MaskState, err?: unknown) => {
    if (stopped) return;
    if (err) console.warn("[blur]", err);
    stop();
    onState(state);
  };

  const paint = (confidence: Float32Array, width: number, height: number) => {
    if (!pixels || pixels.width !== width || pixels.height !== height) {
      stage.width = width;
      stage.height = height;
      pixels = stageCtx.createImageData(width, height);
    }
    const next = steady && steady.length === confidence.length ? steady : new Float32Array(confidence.length);
    steadyMask(steady, confidence, next);
    steady = next;
    maskPixels(steady, pixels.data);
    stageCtx.putImageData(pixels, 0, 0);
    alphaCtx.clearRect(0, 0, alpha.width, alpha.height);
    alphaCtx.drawImage(stage, 0, 0, alpha.width, alpha.height);
    // Redrawn every time, changed or not, so the recorded mask keeps a steady frame rate.
    greyCtx.fillRect(0, 0, grey.width, grey.height);
    greyCtx.drawImage(stage, 0, 0, grey.width, grey.height);
  };

  void (async () => {
    onState("loading");
    // Sized for the job on the copy only; where a browser ignores this, the model scales it down itself.
    await clone
      .applyConstraints({ width: { ideal: SOURCE.width }, height: { ideal: SOURCE.height }, frameRate: { max: MASK.frameRate } })
      .catch(() => {});
    video.srcObject = new MediaStream([clone]);
    void video.play().catch(() => {});
    let { segmenter, delegate } = await loadSegmenter();
    if (stopped) return;

    let pace = FULL_PACE;
    let last = 0;
    let frames = 0;
    let spent = 0;
    let samples = 0;
    let windowStart = 0;
    let busy = false;
    let ready = false;

    const tick = () => {
      if (stopped || busy || video.readyState < 2 || !video.videoWidth) return;
      const now = performance.now();
      if (now - last < pace.intervalMs * 0.8) return;
      last = now;
      try {
        inputCtx.drawImage(video, 0, 0, input.width, input.height);
        segmenter.segmentForVideo(input, now, (result) => {
          // One mask from the selfie model: how sure it is of a person. (Models with a
          // background class as well put the person last.)
          const mask = result.confidenceMasks?.at(-1);
          if (mask) paint(mask.getAsFloat32Array(), mask.width, mask.height);
        });
      } catch (err) {
        if (delegate === "CPU") return fail("failed", err);
        // Some graphics drivers load the model and then fail on a frame: once more, without them.
        busy = true;
        delegate = "CPU";
        reloadOnCpu().then(
          (next) => {
            segmenter = next.segmenter;
            busy = false;
          },
          (cpuErr) => fail("failed", cpuErr),
        );
        return;
      }
      const took = performance.now() - now;
      live = { alpha, at: performance.now() };
      if (!ready) {
        ready = true;
        stream = grey.captureStream(MASK.frameRate);
        onState("ready");
      }
      // The first frames compile shaders and warm caches: they don't say how fast it will be.
      if (++frames <= SLOW.warmUpFrames) return void (windowStart = performance.now());
      spent += took;
      samples++;
      if (performance.now() - windowStart < SLOW.windowMs || samples < SLOW.minSamples) return;
      const next = nextPace(pace, spent / samples);
      spent = samples = 0;
      windowStart = performance.now();
      if (!next) return fail("slow");
      pace = next;
    };
    // In a hidden tab too: the recording goes on there, and so does its mask.
    stopLoop = onEachFrame(video, MASK.frameRate, tick, true);
    if (stopped) stopLoop();
  })().catch((err) => fail("failed", err));

  // The camera went away: nothing to segment (the recorder's own handling tells the person).
  clone.addEventListener("ended", () => stop());

  return { stream: () => stream, stop };
}

// ── For the green room and the room ──────────────────────────────────────────

export const BLUR_PROBLEMS = {
  unsupported: "Blur isn't available in this browser.",
  failed: "Blur couldn't start on this device, so it's off.",
  slow: "This device can't keep up with blur, so it's off.",
  recorder: "Blur couldn't be recorded on this device, so it's off.",
} as const;

export interface BackgroundBlur {
  /** off: not chosen. loading: "Getting ready…". ready: masks are being made. */
  status: "off" | "loading" | "ready";
  /** Why blur went off by itself, in words for the panel; null when it didn't. */
  problem: string | null;
  /** The mask to record next to the camera; null unless ready. */
  maskStream: MediaStream | null;
  /** Something else went wrong with blur (recording its mask): turn it off and say why. */
  giveUp(reason: keyof typeof BLUR_PROBLEMS): void;
}

const blurOff = (prefs: FilterPrefs): FilterPrefs => ({ ...prefs, filters: { ...prefs.filters, background: "none" } });

/**
 * Runs the mask while this person has background blur on and a camera. Any failure turns blur
 * off in their filters (so the call, the preview and the server all hear it) and leaves the
 * reason to show in the panel; turning blur on again tries again.
 */
export function useBackgroundBlur(stream: MediaStream | null, prefs: FilterPrefs): BackgroundBlur {
  const camera = stream?.getVideoTracks()[0] ?? null;
  const on = needsMask(prefs.filters) && !!camera;
  const [status, setStatus] = useState<BackgroundBlur["status"]>("off");
  const [problem, setProblem] = useState<string | null>(null);
  const [maskStream, setMaskStream] = useState<MediaStream | null>(null);

  const giveUp = (reason: keyof typeof BLUR_PROBLEMS) => {
    const current = getFilterPrefs();
    if (!needsMask(current.filters)) return; // the person turned it off themselves meanwhile
    setProblem(BLUR_PROBLEMS[reason]);
    setFilterPrefs(blurOff(current));
  };

  useEffect(() => {
    if (!on || !camera) return;
    setProblem(null);
    if (!maskSupported()) return giveUp("unsupported");
    setStatus("loading");
    const mask = startPersonMask(camera, (state) => {
      if (state === "loading") return;
      if (state === "ready") {
        setStatus("ready");
        setMaskStream(mask.stream());
      } else giveUp(state);
    });
    return () => {
      mask.stop();
      setStatus("off");
      setMaskStream(null);
    };
    // giveUp only uses the filters store and state setters.
  }, [on, camera]);

  return { status: on ? status : "off", problem, maskStream, giveUp };
}
