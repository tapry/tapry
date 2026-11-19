"use client";

// A camera that is on but sends a black picture. Browsers do this without an error when they
// take the camera away (another tab or app has it) or can't keep up, and the recording is then
// black too: every iPhone video in a 4K studio was, and nobody was told (16 Nov 2026). The
// person's own view is looked at, a few pixels every couple of seconds, so no second reader
// of the camera is added.
import type { SessionTicket } from "@tapry/shared";
import { useEffect, useState } from "react";
import { diagFor } from "./diag";

/** Nothing brighter than this (0-255) anywhere in the picture counts as black. */
export const BLACK_BELOW = 10;
/** Black for this long, without a break, before anyone is told. */
export const BLACK_AFTER_MS = 6000;
const EVERY_MS = 2000;

/** One camera: the brightest value of each look in, "black" out. Kept apart from the browser so it can be tested. */
export class BlackWatch {
  private since: number | null = null;

  /** `brightest`: the brightest colour value in the picture now, or null when there is no picture to judge. */
  add(brightest: number | null, now: number) {
    if (brightest === null || brightest >= BLACK_BELOW) this.since = null;
    else this.since ??= now;
  }

  black(now: number) {
    return this.since !== null && now - this.since >= BLACK_AFTER_MS;
  }
}

/** The brightest colour value in the element's current frame, sampled small; null when it has no frame. */
function brightest(video: HTMLVideoElement, canvas: HTMLCanvasElement): number | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let most = 0;
    for (let i = 0; i < d.length; i += 4) most = Math.max(most, d[i]!, d[i + 1]!, d[i + 2]!);
    return most;
  } catch {
    return null;
  }
}

/**
 * Whether this person's camera is sending black, judged from their own view in the room (the
 * self tile). `watching`: the camera is meant to be on. Says so in the call diagnostics too.
 */
export function useBlackCamera(ticket: SessionTicket, watching: boolean): boolean {
  const [black, setBlack] = useState(false);
  useEffect(() => {
    if (!watching) return setBlack(false);
    const watch = new BlackWatch();
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 18;
    const note = diagFor(ticket);
    let was = false;
    const timer = setInterval(() => {
      const now = performance.now();
      const view = document.querySelector<HTMLVideoElement>('[data-testid="self-tile"] video');
      watch.add(document.hidden || !view ? null : brightest(view, canvas), now);
      const is = watch.black(now);
      if (is !== was) note(is ? "camera.black" : "camera.picture_back");
      was = is;
      setBlack(is);
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [ticket, watching]);
  return black;
}
