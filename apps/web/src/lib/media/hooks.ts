"use client";

import { readStored, writeStored } from "@/lib/client/stored";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  classifyLevel,
  describeMediaError,
  measureLevel,
  meterRelease,
  withoutDeviceIds,
  type LevelState,
  type MediaProblem, widescreenRequest } from "./media";

export interface Devices {
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
}

const EMPTY: Devices = { audioInputs: [], videoInputs: [], audioOutputs: [] };

/** Device lists, refreshed when devices are plugged in or out. Labels appear only after permission. */
export function useDevices(refreshKey: unknown): Devices {
  const [devices, setDevices] = useState<Devices>(EMPTY);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    let cancelled = false;
    const load = async () => {
      const all = await md.enumerateDevices();
      if (cancelled) return;
      setDevices({
        audioInputs: all.filter((d) => d.kind === "audioinput" && d.deviceId),
        videoInputs: all.filter((d) => d.kind === "videoinput" && d.deviceId),
        audioOutputs: all.filter((d) => d.kind === "audiooutput" && d.deviceId),
      });
    };
    void load();
    md.addEventListener("devicechange", load);
    return () => {
      cancelled = true;
      md.removeEventListener("devicechange", load);
    };
  }, [refreshKey]);
  return devices;
}

export type MediaStatus = "starting" | "live" | "error";

/**
 * Opens camera + mic for the given constraints and keeps exactly one stream alive:
 * changing constraints stops the old tracks before the new ones start.
 */
/**
 * In a 4K studio, a camera without 4K may answer with a 4:3 mode that looks zoomed in a
 * widescreen tile: ask it again for its largest 16:9 size (see widescreenRequest). Done here,
 * before anything records or is cloned from the track. Never fails the stream: the picture
 * it already has is kept when the camera won't change.
 */
async function keepWidescreen(stream: MediaStream, c: MediaStreamConstraints) {
  const track = stream.getVideoTracks()[0];
  const video = typeof c.video === "object" ? c.video : null;
  const askedHeight = typeof video?.height === "object" ? Number(video.height.ideal) : 0;
  if (!track || !askedHeight) return;
  const size = widescreenRequest({ height: askedHeight }, track.getSettings(), typeof track.getCapabilities === "function" ? track.getCapabilities() : null);
  if (!size) return;
  await track
    .applyConstraints({ ...video, width: { ideal: size.width }, height: { ideal: size.height }, aspectRatio: { ideal: size.width / size.height } })
    .catch(() => {});
}

/**
 * Camera and mic requests on this page, one after the other. A returning visitor's remembered
 * device choice arrives a moment after the first render, so the green room would ask for the
 * camera with the defaults and again with the choice while the first request was still open.
 * An iPhone has one camera capture for the page: the later request takes it, and the picture
 * that was kept could stay black with the camera on. Nothing here is ever open twice.
 */
let lastOpen: Promise<unknown> = Promise.resolve();
function afterOtherOpens<T>(job: () => Promise<T>): Promise<T> {
  const run = lastOpen.then(job, job);
  lastOpen = run.catch(() => {});
  return run;
}

/** A camera that stays blank this long on a page that's in view is opened again (twice at most). */
const BLANK_CAMERA_MS = 2000;
const BLANK_CAMERA_RETRIES = 2;

export function useLocalMedia(constraints: MediaStreamConstraints) {
  const key = JSON.stringify(constraints);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<MediaStatus>("starting");
  const [problem, setProblem] = useState<MediaProblem | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const owned = useRef<MediaStream | null>(null);
  /** Times the camera was reopened by itself because it came up blank; a person's own retry isn't counted. */
  const reopened = useRef(0);

  /** Take over the live stream: the hook will no longer stop it when it unmounts. */
  const handOff = useCallback(() => {
    const s = owned.current;
    owned.current = null;
    return s;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let blank: ReturnType<typeof setTimeout> | undefined;
    let unwatch = () => {};
    setStatus("starting");
    setProblem(null);

    // The browser muted the camera itself (Safari does when something else takes it): the
    // picture is black though the camera is on. Before anyone has joined, opening it again is
    // safe and usually brings it back. Once the room owns the stream this hook is gone.
    const watchBlank = (s: MediaStream) => {
      const track = s.getVideoTracks()[0];
      if (!track) return;
      const check = () => {
        clearTimeout(blank);
        if (!track.muted || track.readyState !== "live" || reopened.current >= BLANK_CAMERA_RETRIES) return;
        blank = setTimeout(() => {
          if (cancelled || owned.current !== s || !track.muted || document.hidden) return;
          reopened.current++;
          setAttempt((n) => n + 1);
        }, BLANK_CAMERA_MS);
      };
      track.addEventListener("mute", check);
      track.addEventListener("unmute", check);
      document.addEventListener("visibilitychange", check);
      unwatch = () => {
        track.removeEventListener("mute", check);
        track.removeEventListener("unmute", check);
        document.removeEventListener("visibilitychange", check);
      };
      check();
    };

    const open = async (c: MediaStreamConstraints, fallback: boolean): Promise<void> => {
      if (cancelled) return; // replaced before its turn came: never opened at all
      try {
        const s = await navigator.mediaDevices.getUserMedia(c);
        await keepWidescreen(s, c);
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        owned.current = s;
        setStream(s);
        setStatus("live");
        watchBlank(s);
      } catch (err) {
        if (cancelled) return;
        const p = describeMediaError(err);
        if (p.retryWithDefaults && fallback) return open(withoutDeviceIds(c), false);
        setStream(null);
        setProblem(p);
        setStatus("error");
      }
    };
    void afterOtherOpens(() => open(JSON.parse(key) as MediaStreamConstraints, true));

    return () => {
      cancelled = true;
      clearTimeout(blank);
      unwatch();
      owned.current?.getTracks().forEach((t) => t.stop());
      owned.current = null;
    };
  }, [key, attempt]);

  return { stream, status, problem, retry, handOff };
}

export interface MicLevel {
  /** Smoothed level for the meter bar, dBFS. */
  rmsDb: number;
  state: LevelState;
  /** AudioContext waiting for a click (autoplay policy). */
  suspended: boolean;
}

const HISTORY_MS = 3000;

/** Live mic level from the stream's audio track. */
export function useMicLevel(stream: MediaStream | null): MicLevel {
  const [level, setLevel] = useState<MicLevel>({ rmsDb: -100, state: "silent", suspended: false });
  const history = useRef<Array<{ t: number; rms: number; peak: number }>>([]);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser); // not to destination: no local playback of your own voice
    const buf = new Float32Array(analyser.fftSize);
    let smoothed = -100;
    let frame = 0;
    let lastPaint = 0;
    let lastFrame = performance.now();
    history.current = [];

    const resume = () => void ctx.resume();
    window.addEventListener("pointerdown", resume, { once: true });

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      analyser.getFloatTimeDomainData(buf);
      const { rmsDb, peakDb } = measureLevel(buf);
      // Instant attack, steady fall in dB per second, like a hardware meter: the bar
      // stays readable between words instead of dropping to zero after each one.
      smoothed = meterRelease(smoothed, rmsDb, now - lastFrame);
      lastFrame = now;
      const h = history.current;
      h.push({ t: now, rms: rmsDb, peak: peakDb });
      while (h.length && h[0]!.t < now - HISTORY_MS) h.shift();
      if (now - lastPaint < 50) return; // ~20 renders a second is plenty
      lastPaint = now;
      const loudest = Math.max(...h.map((x) => x.rms));
      const peak = Math.max(...h.map((x) => x.peak));
      setLevel({ rmsDb: smoothed, state: classifyLevel(loudest, peak), suspended: ctx.state === "suspended" });
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", resume);
      source.disconnect();
      void ctx.close();
    };
  }, [stream]);

  return level;
}

/** Remembered device choices (per browser), by name (lib/client/stored.ts). Storage may be unavailable; then nothing is remembered. */
export function useStoredState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = readStored(key);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch {}
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        writeStored(key, JSON.stringify(v));
      } catch {}
    },
    [key],
  );
  return [value, set];
}
