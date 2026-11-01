import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./ffmpeg.js";

export interface WhisperOptions {
  /** whisper.cpp's `whisper-cli`. */
  whisper: string;
  /** ggml model file, e.g. ggml-base.bin (multilingual). */
  model: string;
  /** Silero VAD model for whisper.cpp. Strongly recommended: stops Whisper inventing text in silence. */
  vadModel?: string;
  ffmpeg: string;
  /** "auto" (default) detects per speaker. */
  language?: string;
  threads?: number;
  timeoutMs?: number;
}

export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SpeakerTranscript {
  speaker: string;
  language: string | null;
  segments: Segment[];
}

/** Transcribe one person's audio (any format ffmpeg reads). */
export async function transcribeAudio(audioPath: string, opts: WhisperOptions): Promise<{ language: string | null; segments: Segment[] }> {
  const work = await mkdtemp(join(tmpdir(), "tapry-whisper-"));
  try {
    // whisper.cpp wants 16 kHz mono PCM.
    const wav16 = join(work, "in.wav");
    await run(opts.ffmpeg, ["-y", "-hide_banner", "-nostdin", "-i", audioPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav16], {
      timeoutMs: opts.timeoutMs,
    });
    const outBase = join(work, "out");
    await run(
      opts.whisper,
      [
        "-m", opts.model,
        "-f", wav16,
        "-l", opts.language ?? "auto",
        "-t", String(opts.threads ?? 4),
        "-oj", "-of", outBase,
        "-np", // no progress/log noise on stdout
        "--suppress-nst", // drop non-speech tokens like [MUSIC]
        ...(opts.vadModel ? ["--vad", "-vm", opts.vadModel] : []),
      ],
      { timeoutMs: opts.timeoutMs },
    );
    const json = JSON.parse(await readFile(`${outBase}.json`, "utf8")) as WhisperJson;
    const segments = (json.transcription ?? [])
      .map((s) => ({ startMs: s.offsets.from, endMs: s.offsets.to, text: s.text.trim() }))
      .filter((s) => s.text && !isHallucination(s.text));
    return { language: json.result?.language ?? null, segments };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

interface WhisperJson {
  result?: { language?: string };
  transcription?: Array<{ offsets: { from: number; to: number }; text: string }>;
}

// Whisper's classic inventions on near-silence, which VAD doesn't always catch. Only exact
// whole-segment matches are dropped, so real speech containing these words is kept.
const HALLUCINATIONS = [
  /^(\[|\()?(blank_audio|silence|music|applause|laughter|inaudible)(\]|\))?\.?$/i,
  /^(thank you|thanks for watching|thank you for watching)[.!]?$/i,
  /^(sous-titrage|sous-titres).*$/i,
  /^\.+$/,
];
const isHallucination = (text: string) => HALLUCINATIONS.some((re) => re.test(text.trim()));

export interface Line {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

/** Everyone's segments on one timeline, by start time. */
export function mergeSpeakers(speakers: SpeakerTranscript[]): Line[] {
  return speakers
    .flatMap((s) => s.segments.map((seg) => ({ speaker: s.speaker, ...seg })))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
function stamp(ms: number, sep: "," | ".") {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(t % 1000, 3)}`;
}

/** SubRip: numbered cues, speaker name in front of each line. */
export function toSrt(lines: Line[]) {
  return lines
    .map((l, i) => `${i + 1}\n${stamp(l.startMs, ",")} --> ${stamp(l.endMs, ",")}\n${l.speaker}: ${l.text}\n`)
    .join("\n");
}

/** WebVTT with voice tags, so players and editors can tell speakers apart. */
export function toVtt(lines: Line[]) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    "WEBVTT\n\n" +
    lines.map((l) => `${stamp(l.startMs, ".")} --> ${stamp(l.endMs, ".")}\n<v ${esc(l.speaker)}>${esc(l.text)}\n`).join("\n")
  );
}

/** Readable transcript: one paragraph per turn, consecutive lines of the same speaker joined. */
export function toTxt(lines: Line[]) {
  const turns: Line[] = [];
  for (const l of lines) {
    const last = turns.at(-1);
    if (last && last.speaker === l.speaker && l.startMs - last.endMs < 3000) {
      last.text += ` ${l.text}`;
      last.endMs = l.endMs;
    } else {
      turns.push({ ...l });
    }
  }
  return turns.map((t) => `[${stamp(t.startMs, ".").slice(0, 8)}] ${t.speaker}: ${t.text}`).join("\n\n") + "\n";
}
