"use client";

import { hasVideoFilters, NO_FILTERS, type TrackFilters } from "@tapry/shared";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui";
import { canPreviewFilters, drawFiltered, fitSize, onEachFrame } from "@/lib/client/filter-picture";

/** The preview is drawn like the call's copy, so what you see is what the others get. */
const PREVIEW = { maxHeight: 360, frameRate: 24 };

/**
 * Your own camera, as you see it: the plain stream in a <video>, as always. With picture filters,
 * a canvas over it shows the same frames drawn the way the call sends them. The stream is only
 * looked at here: the recorder's tracks are never changed. Mirroring flips this view only.
 * The parent must be positioned (the canvas fills it).
 */
export function SelfVideo({
  stream,
  filters = NO_FILTERS,
  mirror = true,
  className,
}: {
  stream: MediaStream | null;
  filters?: TrackFilters;
  mirror?: boolean;
  /** Extra classes for the <video> (the canvas takes the mirroring only). */
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Known after mounting only (it asks the browser), so the first render matches the server's.
  const [canPreview, setCanPreview] = useState(false);
  useEffect(() => setCanPreview(canPreviewFilters()), []);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  const filtered = canPreview && !!stream && stream.getVideoTracks().length > 0 && hasVideoFilters(filters);
  const latest = useRef(filters);
  latest.current = filters;
  useEffect(() => {
    const v = video.current;
    const c = canvas.current;
    const ctx = filtered && c ? c.getContext("2d", { alpha: false }) : null;
    if (!v || !c || !ctx) return;
    const draw = () => {
      if (v.readyState < 2) return;
      const size = fitSize(v.videoWidth, v.videoHeight, PREVIEW.maxHeight);
      if (!size.width) return;
      if (c.width !== size.width || c.height !== size.height) {
        c.width = size.width;
        c.height = size.height;
      }
      drawFiltered(ctx, v, c.width, c.height, latest.current);
    };
    draw();
    // Nobody sees a hidden tab's preview: the drawing pauses there.
    return onEachFrame(v, PREVIEW.frameRate, draw, false);
  }, [filtered, stream]);

  return (
    <>
      <video ref={video} autoPlay playsInline muted className={cn("size-full object-cover", mirror && "-scale-x-100", className)} />
      {filtered && (
        <canvas
          ref={canvas}
          aria-hidden
          data-testid="filtered-picture"
          className={cn("pointer-events-none absolute inset-0 size-full object-cover", mirror && "-scale-x-100")}
        />
      )}
    </>
  );
}
