"use client";

import { useEffect, useRef, useState } from "react";

/** Locally hosted demo footage; only play while visible and motion is welcome. */
export function HeroVideo({ src, poster, paused }: { src: string; poster: string; paused: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

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
      if (!video.getAttribute("src")) video.src = src;
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
      onError={() => setFailed(true)}
      style={style}
    />
  );
}
