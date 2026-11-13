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
  type MediaProblem,
} from "./media";

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
export function useLocalMedia(constraints: MediaStreamConstraints) {
  const key = JSON.stringify(constraints);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<MediaStatus>("starting");
  const [problem, setProblem] = useState<MediaProblem | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const owned = useRef<MediaStream | null>(null);

  /** Take over the live stream: the hook will no longer stop it when it unmounts. */
  const handOff = useCallback(() => {
    const s = owned.current;
    owned.current = null;
    return s;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("starting");
    setProblem(null);

    const open = async (c: MediaStreamConstraints, fallback: boolean): Promise<void> => {
      try {
        const s = await navigator.mediaDevices.getUserMedia(c);
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        owned.current = s;
        setStream(s);
        setStatus("live");
      } catch (err) {
        if (cancelled) return;
        const p = describeMediaError(err);
        if (p.retryWithDefaults && fallback) return open(withoutDeviceIds(c), false);
        setStream(null);
        setProblem(p);
        setStatus("error");
      }
    };
    void open(JSON.parse(key) as MediaStreamConstraints, true);

    return () => {
      cancelled = true;
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
