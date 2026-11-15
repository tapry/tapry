"use client";

// Who is talking, heard on this device. The call server also says who the "active speakers"
// are, but only for fairly loud speech and after a delay, so a quiet voice never lit up. Here
// each person's incoming sound is measured directly, against that person's own background
// noise, the same way a device measures its own microphone (quality.ts).
import { useEffect, useRef, useState } from "react";
import { measureLevel } from "@/lib/media/media";
import { NOISE_WINDOW_MS, SPEECH_ABOVE_FLOOR_DB, SPEECH_HANGOVER_MS, SPEECH_MIN_DB } from "./quality";

/** One voice: readings in, "talking" out. Kept apart from the browser so it can be tested. */
export class VoiceActivity {
  private levels: Array<{ t: number; rmsDb: number }> = [];
  private lastSpeech = -Infinity;

  /** One reading of the level (dBFS), taken at `now`. */
  add(rmsDb: number, now: number) {
    this.levels.push({ t: now, rmsDb });
    while (this.levels[0]!.t < now - NOISE_WINDOW_MS) this.levels.shift();
    // The room's noise: the quiet tenth of the last while. Talking stands well above it.
    const sorted = this.levels.map((l) => l.rmsDb).sort((a, b) => a - b);
    const floorDb = sorted[Math.floor(sorted.length / 10)]!;
    if (rmsDb >= Math.max(floorDb + SPEECH_ABOVE_FLOOR_DB, SPEECH_MIN_DB)) this.lastSpeech = now;
  }

  /** Carried over the gaps between words, so it doesn't flicker. */
  talking(now: number) {
    return now - this.lastSpeech <= SPEECH_HANGOVER_MS;
  }
}

const EVERY_MS = 100;

/**
 * The ids of the people this device hears talking right now. `voices`: each person's incoming
 * audio track (none while they are muted or not yet heard). Reading a track's level changes
 * nothing about how it plays.
 */
export function useHeardTalking(voices: Array<{ id: string; track: MediaStreamTrack | undefined }>): ReadonlySet<string> {
  const [talking, setTalking] = useState<ReadonlySet<string>>(new Set());
  const latest = useRef(voices);
  latest.current = voices;
  // Start again only when the set of tracks changes, not on every render.
  const key = voices.map((v) => `${v.id}:${v.track?.id ?? ""}`).join("|");

  useEffect(() => {
    if (typeof AudioContext === "undefined" || !latest.current.some((v) => v.track)) {
      setTalking((was) => (was.size === 0 ? was : new Set()));
      return;
    }
    const ctx = new AudioContext();
    void ctx.resume().catch(() => {});
    const buf = new Float32Array(2048);
    const heard = latest.current.flatMap((v) => {
      if (!v.track || v.track.readyState !== "live") return [];
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const source = ctx.createMediaStreamSource(new MediaStream([v.track]));
      source.connect(analyser);
      return [{ id: v.id, analyser, source, voice: new VoiceActivity() }];
    });
    const timer = setInterval(() => {
      // A context waiting for a click reads silence: say nothing then.
      if (ctx.state !== "running") return;
      const now = Date.now();
      const next = new Set<string>();
      for (const h of heard) {
        h.analyser.getFloatTimeDomainData(buf);
        h.voice.add(measureLevel(buf).rmsDb, now);
        if (h.voice.talking(now)) next.add(h.id);
      }
      setTalking((was) => (was.size === next.size && [...next].every((id) => was.has(id)) ? was : next));
    }, EVERY_MS);
    return () => {
      clearInterval(timer);
      for (const h of heard) h.source.disconnect();
      void ctx.close().catch(() => {});
    };
  }, [key]);

  return talking;
}
