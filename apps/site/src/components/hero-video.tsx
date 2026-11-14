"use client";

import { useEffect, useRef, useState } from "react";

/** Locally hosted demo footage; only play while visible and motion is welcome. */
export function HeroVideo({ src, poster, paused, onProgress }: { src: string; poster: string; paused: boolean; onProgress: (time: number) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  // Follow presented frames rather than a separate timer or coarse timeupdate events.
  useEffect(() => {
    const video = ref.current;
    if (!video || failed || typeof video.requestVideoFrameCallback !== "function") return;
    let frame = 0;
    const update: VideoFrameRequestCallback = (_, metadata) => {
      onProgress(metadata.mediaTime);
      frame = video.requestVideoFrameCallback(update);
    };
    const start = () => {
      video.cancelVideoFrameCallback(frame);
      frame = video.requestVideoFrameCallback(update);
    };
    video.addEventListener("loadeddata", start);
    video.addEventListener("playing", start);
    if (video.readyState >= 2) start();
    return () => {
      video.removeEventListener("loadeddata", start);
      video.removeEventListener("playing", start);
      video.cancelVideoFrameCallback(frame);
    };
  }, [src, onProgress, failed]);

  useEffect(() => {
    const video = ref.current;
    if (!video || failed) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const update = () => {
      const play = visible && !paused && !motion.matches && !document.hidden;
      video.autoplay = play;
      if (!play) {
        video.pause();
        return;
      }
      // Leave src unset until needed, so reduced-motion visitors only load the poster.
      if (video.getAttribute("src") !== src) {
        video.src = src;
        video.load();
      }
      void video.play().catch(() => {
        // Autoplay can be blocked by browser preferences; the poster remains visible.
      });
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      update();
    });
    observer.observe(video);
    motion.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);

    return () => {
      observer.disconnect();
      motion.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
      video.autoplay = false;
      video.pause();
    };
  }, [src, paused, failed]);

  const style = { display: "block", width: "100%", height: "100%", objectFit: "cover" as const };
  if (failed) return <img src={poster} alt="" style={style} />;

  return (
    <video
      ref={ref}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      tabIndex={-1}
      aria-hidden="true"
      onError={() => setFailedSrc(src)}
      onTimeUpdate={(event) => {
        if (typeof event.currentTarget.requestVideoFrameCallback !== "function") onProgress(event.currentTarget.currentTime);
      }}
      style={style}
    />
  );
}
