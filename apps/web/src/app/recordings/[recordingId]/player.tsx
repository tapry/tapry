"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { shortClock } from "@/lib/format";
import { Icon } from "@/components/ui-extra";
import { cn } from "@/components/ui";

const BARS = 90;
/**
 * The waveform is drawn from the real sound, decoded in this browser, only for files up to this
 * size (a few minutes of WAV; decoding needs the whole file in memory). Bigger ones, or when the
 * file can't be fetched from here (storage without CORS for this site), get a plain seek bar:
 * never a made-up waveform.
 */
const PEAKS_MAX_BYTES = 50 * 1024 * 1024;

/** Loudest point in each of `n` equal slices, across channels, scaled so the loudest is 1. */
function peaksOf(buffer: AudioBuffer, n: number) {
  const out = new Array<number>(n).fill(0);
  const per = Math.max(1, Math.floor(buffer.length / n));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let max = 0;
      const end = Math.min(data.length, (i + 1) * per);
      // Every 8th sample is plenty to find a slice's peak, and keeps long files quick.
      for (let j = i * per; j < end; j += 8) max = Math.max(max, Math.abs(data[j]!));
      out[i] = Math.max(out[i]!, max);
    }
  }
  const top = Math.max(...out) || 1;
  return out.map((v) => v / top);
}

/** The recording page's player: the combined sound, with its real waveform when it can be had. */
export function RecordingPlayer({ src, bytes, lengthMs }: { src: string; bytes: number; lengthMs: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(lengthMs);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (bytes > PEAKS_MAX_BYTES) return;
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch(src, { signal: abort.signal });
        if (!res.ok) return;
        const decoded = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(await res.arrayBuffer());
        if (!abort.signal.aborted) setPeaks(peaksOf(decoded, BARS));
      } catch {
        // Can't fetch or decode it here: the plain seek bar stays.
      }
    })();
    return () => abort.abort();
  }, [src, bytes]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setFailed(true));
    else a.pause();
  };
  const seekTo = (ms: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(durMs, ms)) / 1000;
    setPosMs(a.currentTime * 1000);
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - box.left) / box.width) * durMs);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 5000, ArrowUp: 5000, ArrowLeft: -5000, ArrowDown: -5000 }[e.key];
    if (step !== undefined) seekTo(posMs + step);
    else if (e.key === "Home") seekTo(0);
    else if (e.key === "End") seekTo(durMs);
    else return;
    e.preventDefault();
  };
  const played = durMs > 0 ? posMs / durMs : 0;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-surface px-[18px] py-4">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosMs(e.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDurMs(e.currentTarget.duration * 1000)}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        aria-pressed={playing}
        className="grid size-[46px] shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-accent-text transition-colors hover:bg-accent-hover"
      >
        <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d={playing ? "M7 4v16M17 4v16" : "M6 4l14 8l-14 8z"} />
        </svg>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div
          role="slider"
          tabIndex={0}
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(durMs / 1000)}
          aria-valuenow={Math.round(posMs / 1000)}
          aria-valuetext={`${shortClock(posMs)} of ${shortClock(durMs)}`}
          onClick={onClick}
          onKeyDown={onKey}
          className="flex h-11 cursor-pointer items-center rounded-sm focus-visible:outline-offset-4"
        >
          {peaks ? (
            <span aria-hidden className="flex h-full w-full items-center gap-0.5 overflow-hidden">
              {peaks.map((p, k) => (
                <span
                  key={k}
                  className={cn("min-w-px flex-[1_1_0] rounded-[1px] transition-colors", k / BARS <= played ? "bg-accent" : "bg-border-strong")}
                  style={{ height: `${Math.round(8 + 84 * p)}%` }}
                />
              ))}
            </span>
          ) : (
            <span aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${played * 100}%` }} />
            </span>
          )}
        </div>
        <span className="flex justify-between text-[12.5px] text-muted tabular-nums">
          <span>{failed ? "Couldn't play this file here. Download it below." : shortClock(posMs)}</span>
          <span>{shortClock(durMs)}</span>
        </span>
      </div>
    </div>
  );
}
