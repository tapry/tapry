// "Follows the speaker": who is talking when, worked out from each person's own audio (speaker
// = track, so there is nothing to guess), and from that the stretches of the combined video
// that show one person full frame. The rest of the time the grid shows everyone.
import { run } from "./ffmpeg.js";

/** Seconds: [start, end). */
export type Interval = [number, number];

/** Quieter than this for this long is a pause. The voices have been levelled to about -16 LUFS first. */
export const SPEECH = { noiseDb: -38, minSilenceS: 0.35 };

/** silencedetect's report (printed by two ametadata filters, in any order) turned into when the person talks. */
export function speechFromSilence(report: string, durationS: number): Interval[] {
  const values = (key: string) => [...report.matchAll(new RegExp(`lavfi\\.${key}=(-?[\\d.]+)`, "g"))].map((m) => Number(m[1])).sort((a, b) => a - b);
  const starts = values("silence_start");
  const ends = values("silence_end");
  const speech: Interval[] = [];
  let at = 0; // where talking may begin
  for (const start of starts) {
    const from = Math.max(0, start);
    if (from > at + 0.05) speech.push([at, Math.min(from, durationS)]);
    // The pause that began here ends at the first end after it; none: it lasts to the end.
    const end = ends.find((e) => e > from);
    at = end === undefined ? durationS : end;
  }
  if (at < durationS - 0.05) speech.push([at, durationS]);
  return speech.filter(([a, b]) => b > a);
}

/** When this person talks, from their finished audio file. */
export async function detectSpeech(ffmpeg: string, audioPath: string, durationS: number, timeoutMs?: number): Promise<Interval[]> {
  const out = await run(
    ffmpeg,
    ["-hide_banner", "-nostdin", "-nostats", "-v", "error", "-i", audioPath, "-vn",
      "-af", `silencedetect=noise=${SPEECH.noiseDb}dB:d=${SPEECH.minSilenceS},ametadata=mode=print:key=lavfi.silence_start:file=-,ametadata=mode=print:key=lavfi.silence_end:file=-`,
      "-f", "null", "-"],
    { timeoutMs },
  );
  return speechFromSilence(out, durationS);
}

/**
 * How the picture is cut. Tuned to feel like a calm edit, not a voice-activated switch:
 * someone must have the floor for `takeS` before the picture goes to them, a breath or a
 * short "mm-hm" from someone else doesn't take it away (`gapS`, `takeS`), two people talking
 * over each other for `overlapS` or nobody talking for `quietS` brings the grid back, and no
 * shot is shorter than `minShotS`.
 */
export const SHOTS = { stepS: 0.1, takeS: 1.2, gapS: 1.5, overlapS: 2, quietS: 3, minShotS: 2.5 };

export interface Shot {
  id: string;
  start: number;
  end: number;
}

/**
 * The stretches where one person fills the frame. `speech`: when each person talks. Only the
 * people in `canFill` (those with a camera) get shots; while anyone else has the floor, the
 * grid stays.
 */
export function speakerShots(speech: Map<string, Interval[]>, durationS: number, canFill: Set<string>): Shot[] {
  const ids = [...speech.keys()];
  if (ids.length < 2 || durationS <= 0) return [];
  const steps = Math.ceil(durationS / SHOTS.stepS);
  // Who talks in each step.
  const talking: string[][] = Array.from({ length: steps }, () => []);
  for (const id of ids) {
    for (const [a, b] of speech.get(id)!) {
      for (let i = Math.max(0, Math.floor(a / SHOTS.stepS)); i < Math.min(steps, Math.ceil(b / SHOTS.stepS)); i++) talking[i]!.push(id);
    }
  }
  const n = (s: number) => Math.round(s / SHOTS.stepS);
  const shots: Shot[] = [];
  let floor: string | null = null; // who the picture is on (null: the grid)
  let since = 0; // step the current picture began
  let lastHeard = 0; // last step the floor's holder talked
  let rival: string | null = null; // someone else talking alone, and since when
  let rivalSince = 0;
  let overlapSince = -1;
  const cut = (to: string | null, at: number) => {
    if (floor && canFill.has(floor) && at > since) shots.push({ id: floor, start: since * SHOTS.stepS, end: at * SHOTS.stepS });
    floor = to;
    since = at;
    lastHeard = at;
    rival = null;
    overlapSince = -1;
  };
  for (let i = 0; i < steps; i++) {
    const who = talking[i]!;
    const sole = who.length === 1 ? who[0]! : null;
    if (floor && who.includes(floor)) lastHeard = i;
    // Several at once, for long enough: everyone.
    if (who.length >= 2) {
      if (overlapSince < 0) overlapSince = i;
      if (floor && i - overlapSince >= n(SHOTS.overlapS)) cut(null, overlapSince);
    } else overlapSince = -1;
    // Someone else alone: they take the floor once they have held it for a moment.
    if (sole && sole !== floor) {
      if (rival !== sole) {
        rival = sole;
        rivalSince = i;
      }
      const holderQuiet = !floor || i - lastHeard >= 1;
      if (holderQuiet && i - rivalSince + 1 >= n(SHOTS.takeS)) cut(sole, rivalSince);
    } else if (who.length === 0 || sole === floor) rival = sole === floor ? null : rival;
    // Nobody for a while: everyone.
    if (floor && who.length === 0 && i - lastHeard >= n(SHOTS.quietS)) cut(null, lastHeard + n(SHOTS.gapS));
  }
  cut(null, steps);
  // No flicker: a shot too short to read goes back to the grid, and shots of the same person that touch are one.
  const merged: Shot[] = [];
  for (const s of shots) {
    const last = merged.at(-1);
    if (last && last.id === s.id && s.start - last.end < 0.05) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged
    .filter((s) => s.end - s.start >= SHOTS.minShotS)
    .map((s) => ({ id: s.id, start: Math.round(s.start * 1000) / 1000, end: Math.min(durationS, Math.round(s.end * 1000) / 1000) }));
}
