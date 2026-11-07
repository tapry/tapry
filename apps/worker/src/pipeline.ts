import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import { FfmpegError, probeDurationMs, probeStreams, run } from "./ffmpeg.js";

export interface TrackInput {
  trackId: string;
  participantId: string;
  participantName: string;
  kind: "audio" | "video";
  /** The track's chunks concatenated in seq order (WebM or MP4 as MediaRecorder wrote it). */
  rawPath: string;
  /** Track start minus recording start, server clock. Positive: the track started late. */
  offsetMs: number;
  /** A chunk is missing from the middle: time the sound by its timestamps, so what follows stays in place. */
  hasGaps?: boolean;
}

/** A track or file left out because ffmpeg couldn't read or render it. */
export interface SkippedTrack {
  trackId?: string;
  participantId?: string;
  participantName?: string;
  kind: "audio" | "video" | "combined";
  reason: string;
}

export interface PipelineOptions {
  /** A track was left out and the rest rendered without it. */
  onSkipped?: (skipped: SkippedTrack) => void;
  ffmpeg: string;
  ffprobe: string;
  /** Scratch folder for outputs; the caller uploads and deletes it. */
  workDir: string;
  /** Recording length (Record → Stop). Every output is exactly this long. */
  durationMs: number;
  videoHeight: 720 | 1080;
  /** Per ffmpeg invocation. Default: 10× real time, at least 2 minutes. */
  timeoutMs?: number;
  /** Font for names on the combined video's tiles. Unset: found automatically; null: no names. */
  font?: string | null;
  /** Level every person's audio, and the combined mix, to this target. Unset or null: left as recorded. */
  loudness?: LoudnessTarget | null;
  /** Audio files as WAV (default) or FLAC (lossless, about half the size). */
  audioFormat?: "wav" | "flac";
  /** Told before each file is rendered: how many are done, of how many, and which one is next. */
  onProgress?: (p: { done: number; total: number; current: string }) => void;
}

export interface LoudnessTarget {
  /** Integrated loudness to aim for (EBU R128, LUFS). */
  lufs: number;
  /** Never let the true peak go above this (dBTP): the gain is lowered instead. */
  truePeakDb: number;
  /** Most a quiet track is raised, so a near-silent mic doesn't become loud hiss. */
  maxBoostDb: number;
}

/** What podcast platforms ask for (Apple: -16 LUFS, peaks under -1 dBTP). */
export const PODCAST_LOUDNESS: LoudnessTarget = { lufs: -16, truePeakDb: -1, maxBoostDb: 20 };

export interface LoudnessMeasurement {
  /** Integrated loudness in LUFS; null for silence (nothing above the -70 LUFS gate). */
  integrated: number | null;
  /** True peak in dBTP; null for digital silence. */
  truePeak: number | null;
}

export interface OutputFile {
  kind: "audio" | "video" | "combined";
  trackId?: string;
  participantId?: string;
  path: string;
  fileName: string;
  contentType: string;
  durationMs: number | null;
  /** Gain applied to level the audio (dB), when loudness levelling is on and the file has sound. */
  gainDb?: number;
}

const FPS = 30;

/**
 * Most bits per second a person's processed video may use: what the browser recorded at
 * (apps/web recording.ts). x264 aims for quality (CRF 20) but never spends more than the original
 * had, so noisy or busy footage can't come out bigger than the upload without being better.
 */
export const VIDEO_MAX_BITRATE = { 1080: 8_000_000, 720: 4_000_000 } as const;

/** x264 flags for a person's final video: constant quality, capped at the original's bitrate. */
function cappedVideo(height: 720 | 1080) {
  const max = VIDEO_MAX_BITRATE[height];
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-maxrate", String(max), "-bufsize", String(max * 2)];
}
const TILE_BG = "0x202020";

/** Join chunk files into one, in the order given. MediaRecorder chunks are byte-continuous. */
export async function concatChunks(chunkPaths: string[], outPath: string) {
  const out = createWriteStream(outPath);
  for (const p of chunkPaths) await streamPipeline(createReadStream(p), out, { end: false });
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
}

const sec = (ms: number) => (ms / 1000).toFixed(3);

/**
 * Filters that put a track on the recording's timeline: a late start is padded with
 * silence / black, an early start (clock error) is trimmed, the end is padded so -t can
 * cut every output to the same length.
 */
export function alignmentFilters(
  kind: "audio" | "video",
  offsetMs: number,
  /** How video ends: freeze the last frame (a whole track), or black (one piece of several). */
  videoEnd: "clone" | "black" = "clone",
  hasGaps = false,
): string {
  const late = Math.max(0, Math.round(offsetMs));
  const early = Math.max(0, Math.round(-offsetMs));
  if (kind === "audio") {
    return [
      // Time audio by sample count from 0. Container timestamps can start below zero
      // (Opus pre-skip) or jitter, which would make -t cut files a few ms short.
      // With a chunk missing, that count would pull everything after the gap earlier, so the
      // timestamps decide and the gap becomes silence (under 10 ms later than a whole track).
      hasGaps ? "aresample=48000:async=1:first_pts=0" : "aresample=48000,asetpts=N/SR/TB",
      early ? `atrim=start=${sec(early)},asetpts=PTS-STARTPTS` : "",
      late ? `adelay=${late}:all=1` : "",
      "apad",
    ]
      .filter(Boolean)
      .join(",");
  }
  return [
    early ? `trim=start=${sec(early)},setpts=PTS-STARTPTS` : "",
    // MediaRecorder writes variable frame rate; editors want constant.
    `fps=${FPS}`,
    late ? `tpad=start_duration=${sec(late)}:start_mode=add:color=black` : "",
    videoEnd === "clone" ? "tpad=stop=-1:stop_mode=clone" : "tpad=stop=-1:stop_mode=add:color=black",
  ]
    .filter(Boolean)
    .join(",");
}

/**
 * Loudness of a file's audio, measured the EBU R128 way by ffmpeg's loudnorm filter
 * (measurement only: its output is discarded).
 */
export async function measureLoudness(ffmpeg: string, path: string, timeoutMs?: number): Promise<LoudnessMeasurement> {
  const stderr = await run(
    ffmpeg,
    ["-hide_banner", "-nostdin", "-nostats", "-i", path, "-vn", "-af", "loudnorm=print_format=json", "-f", "null", "-"],
    { timeoutMs, stderr: true },
  );
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(stderr)?.[0];
  if (!json) throw new Error("ffmpeg did not report loudness");
  const report = JSON.parse(json) as { input_i: string; input_tp: string };
  const num = (v: string) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null; // "-inf" for silence
  };
  const integrated = num(report.input_i);
  return { integrated: integrated !== null && integrated > -70 ? integrated : null, truePeak: num(report.input_tp) };
}

/**
 * The one fixed gain (dB) that brings audio to the target: plain volume, no compression or
 * limiting, so it sounds exactly as recorded, only louder or quieter. Lower than the target
 * asks when the peaks would otherwise pass the ceiling; 0 for silence.
 */
export function loudnessGain(m: LoudnessMeasurement, target: LoudnessTarget): number {
  if (m.integrated === null) return 0;
  let gain = Math.min(target.lufs - m.integrated, target.maxBoostDb);
  if (m.truePeak !== null) gain = Math.min(gain, target.truePeakDb - m.truePeak);
  return Math.round(gain * 100) / 100;
}

/** A volume filter for the gain, or "" when it is too small to matter. */
const volumeFilter = (gainDb: number | undefined) => (gainDb && Math.abs(gainDb) >= 0.05 ? `volume=${gainDb}dB` : "");

/** Grid for n tiles in a 16:9 frame: 1 → 1×1, 2 → 2×1, 3–4 → 2×2, 5–9 → 3×3. */
export function gridLayout(n: number, width = 1920, height = 1080) {
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const even = (x: number) => Math.floor(x / 2) * 2;
  const tileW = even(width / cols);
  const tileH = even(Math.min(height / rows, (tileW * 9) / 16));
  const offsetX = Math.floor((width - cols * tileW) / 2);
  const offsetY = Math.floor((height - rows * tileH) / 2);
  return Array.from({ length: n }, (_, i) => ({
    x: offsetX + (i % cols) * tileW,
    y: offsetY + Math.floor(i / cols) * tileH,
    w: tileW,
    h: tileH,
  }));
}

/**
 * Render every downloadable file for one recording:
 * per participant a WAV of their audio track and an MP4 of their camera track, plus one
 * combined grid video with everyone's audio mixed (a mixed WAV when nobody had a camera on).
 * All aligned to the moment Record was pressed.
 */
export async function renderRecording(tracks: TrackInput[], opts: PipelineOptions): Promise<OutputFile[]> {
  await mkdir(opts.workDir, { recursive: true });
  const timeoutMs = opts.timeoutMs ?? Math.max(120_000, opts.durationMs * 10);
  const duration = sec(opts.durationMs);
  const names = uniqueNames(tracks);
  // Each person's gain comes from their WAV and also applies to the sound in their video,
  // so audio files are rendered first; outputs keep the tracks' order.
  const gains = new Map<string, number>();
  const groups = groupBy(tracks, (t) => `${t.participantId}\u0000${t.kind}`);
  const byGroup = new Map<TrackInput[], OutputFile>();
  let firstFailure: FfmpegError | undefined;
  const skip = (t: TrackInput, err: FfmpegError) => {
    firstFailure ??= err;
    opts.onSkipped?.({ trackId: t.trackId, participantId: t.participantId, participantName: t.participantName, kind: t.kind, reason: failureReason(err) });
  };
  const audioFirst = [...groups].sort((a, b) => Number(a[0]!.kind === "video") - Number(b[0]!.kind === "video"));

  // One file per person per kind. A person can have several tracks of a kind when they
  // rejoined during the recording (tab crash, reload): those pieces are merged in place.
  for (const [i, pieces] of audioFirst.entries()) {
    const first = pieces[0]!;
    const base = names.get(first.trackId)!;
    opts.onProgress?.({ done: i, total: groups.length + 1, current: `${base}'s ${first.kind}` });
    const ext = first.kind === "audio" ? "wav" : "mp4";
    const path = join(opts.workDir, `${first.trackId}.${ext}`);
    const gainDb = first.kind === "video" ? gains.get(first.participantId) : undefined;
    let hasAudio: boolean;
    try {
      if (pieces.length === 1) {
        hasAudio = await renderPiece(first, path, { opts, duration, timeoutMs, multi: false, gainDb });
      } else {
        const parts: Array<{ path: string; hasAudio: boolean }> = [];
        for (const piece of pieces) {
          const partPath = join(opts.workDir, `${piece.trackId}.part.${ext}`);
          try {
            parts.push({ path: partPath, hasAudio: await renderPiece(piece, partPath, { opts, duration, timeoutMs, multi: true }) });
          } catch (err) {
            if (!(err instanceof FfmpegError)) throw err;
            skip(piece, err);
          }
        }
        if (parts.length === 0) continue;
        await mergePieces(first.kind, parts, path, { opts, duration, timeoutMs, gainDb });
        hasAudio = parts.some((p) => p.hasAudio);
      }
    } catch (err) {
      if (!(err instanceof FfmpegError)) throw err;
      skip(first, err);
      continue;
    }
    const output: OutputFile = {
      kind: first.kind,
      trackId: first.trackId,
      participantId: first.participantId,
      path,
      fileName: `${base} - ${first.kind}.${ext}`,
      contentType: first.kind === "audio" ? "audio/wav" : "video/mp4",
      durationMs: await probeDurationMs(opts.ffprobe, path),
    };
    if (opts.loudness && first.kind === "audio") {
      output.gainDb = await levelWav(path, opts.loudness, { opts, duration, timeoutMs });
      gains.set(first.participantId, output.gainDb);
    } else if (gainDb !== undefined && hasAudio) {
      output.gainDb = gainDb;
    }
    byGroup.set(pieces, output);
  }
  const outputs = groups.flatMap((g) => byGroup.get(g) ?? []);
  // Nothing readable at all: more likely the machine than the media, so the job fails and retries.
  if (outputs.length === 0) throw firstFailure ?? new Error("No tracks to render");

  const hasVideo = outputs.some((o) => o.kind === "video");
  opts.onProgress?.({ done: groups.length, total: groups.length + 1, current: hasVideo ? "Side-by-side video" : "Everyone, mixed" });
  // Only people with a file get a tile. People's own files matter most, so a failure here doesn't lose them.
  const rendered = tracks.filter((t) => outputs.some((o) => o.participantId === t.participantId));
  try {
    const combined = await renderCombined(rendered, outputs, opts, timeoutMs);
    if (combined) outputs.push(combined);
  } catch (err) {
    if (!(err instanceof FfmpegError)) throw err;
    opts.onSkipped?.({ kind: "combined", reason: failureReason(err) });
  }
  // FLAC last, from the finished WAVs: alignment and levelling are done once, the same either way.
  if (opts.audioFormat === "flac") {
    for (const o of outputs) if (o.contentType === "audio/wav") await toFlac(o, opts, timeoutMs);
  }
  return outputs;
}

const failureReason = (err: FfmpegError) => `${err.message}: ${err.stderrTail.split("\n").slice(-3).join(" ")}`;

/** Replace a finished WAV output with the same sound as FLAC (lossless). */
async function toFlac(o: OutputFile, opts: PipelineOptions, timeoutMs: number) {
  const path = o.path.replace(/\.wav$/, ".flac");
  await run(opts.ffmpeg, ["-y", "-hide_banner", "-nostdin", "-i", o.path, "-c:a", "flac", "-compression_level", "8", path], { timeoutMs });
  await rm(o.path, { force: true });
  o.path = path;
  o.fileName = o.fileName.replace(/\.wav$/, ".flac");
  o.contentType = "audio/flac";
  o.durationMs = await probeDurationMs(opts.ffprobe, path);
}

interface RenderContext {
  opts: PipelineOptions;
  duration: string;
  timeoutMs: number;
  /** Volume change for the sound (a person's levelling gain, applied to their video). */
  gainDb?: number;
}

/** Measure a rendered WAV and rewrite it at the target loudness. Returns the gain applied. */
async function levelWav(path: string, target: LoudnessTarget, { opts, duration, timeoutMs }: RenderContext) {
  const gainDb = loudnessGain(await measureLoudness(opts.ffmpeg, path, timeoutMs), target);
  const volume = volumeFilter(gainDb);
  if (!volume) return 0;
  const levelled = `${path}.levelled.wav`;
  await run(
    opts.ffmpeg,
    ["-y", "-hide_banner", "-nostdin", "-i", path, "-af", volume, "-t", duration, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", levelled],
    { timeoutMs },
  );
  await rename(levelled, path);
  return gainDb;
}

/**
 * Render one track onto the recording timeline. Returns whether it had audio.
 * `multi`: it's one piece of several for the same person, so pad with black rather than
 * freezing the last frame, and use a fixed 16:9 frame so the pieces can be merged.
 */
async function renderPiece(track: TrackInput, path: string, { opts, duration, timeoutMs, multi, gainDb }: RenderContext & { multi: boolean }) {
  if (track.kind === "audio") {
    await run(
      opts.ffmpeg,
      [...INPUT_FLAGS, "-i", track.rawPath, "-vn", "-af", alignmentFilters("audio", track.offsetMs, "clone", track.hasGaps),
        "-t", duration, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path],
      { timeoutMs },
    );
    return true;
  }
  const hasAudio = (await probeStreams(opts.ffprobe, track.rawPath, RAW_FORMATS)).includes("audio");
  const h = opts.videoHeight;
  const frame = multi
    ? `scale=${even((h * 16) / 9)}:${h}:force_original_aspect_ratio=decrease,pad=${even((h * 16) / 9)}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
    : `scale=-2:${h}`;
  await run(
    opts.ffmpeg,
    [...INPUT_FLAGS, "-i", track.rawPath,
      "-vf", `${alignmentFilters("video", track.offsetMs, multi ? "black" : "clone")},${frame},format=yuv420p`,
      ...(hasAudio ? ["-af", [alignmentFilters("audio", track.offsetMs, "clone", track.hasGaps), volumeFilter(gainDb)].filter(Boolean).join(","), "-c:a", multi ? "pcm_s16le" : "aac", ...(multi ? [] : ["-b:a", "192k"])] : ["-an"]),
      // A piece of several is an intermediate (merged next), so it stays near-lossless and uncapped.
      "-t", duration, ...(multi ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16"] : cappedVideo(opts.videoHeight)), "-r", String(FPS),
      ...(multi ? ["-f", "mov"] : ["-movflags", "+faststart"]), path],
    { timeoutMs },
  );
  return hasAudio;
}

/**
 * Merge aligned pieces of one person's track. Each piece is silent / black outside the time
 * it covers, so mixing the audio and taking the brighter pixel of the videos ("lighten")
 * shows whichever piece was recording at each moment.
 */
async function mergePieces(
  kind: "audio" | "video",
  parts: Array<{ path: string; hasAudio: boolean }>,
  out: string,
  { opts, duration, timeoutMs, gainDb }: RenderContext,
) {
  const inputs = parts.flatMap((p) => ["-i", p.path]);
  // Audio files are levelled after merging (levelWav); a video's sound takes the person's gain here.
  const volume = kind === "video" ? volumeFilter(gainDb) : "";
  const after = volume ? `,${volume}` : "";
  const mix = (labels: string[]) =>
    labels.length > 1
      ? `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0${after}[a]`
      : `${labels[0]}${volume || "anull"}[a]`;
  if (kind === "audio") {
    await run(
      opts.ffmpeg,
      ["-y", "-hide_banner", "-nostdin", ...inputs, "-filter_complex", mix(parts.map((_, i) => `[${i}:a]`)), "-map", "[a]",
        "-t", duration, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", out],
      { timeoutMs },
    );
    return;
  }
  const filters: string[] = [];
  let video = "[0:v]";
  for (let i = 1; i < parts.length; i++) {
    filters.push(`${video}[${i}:v]blend=all_mode=lighten[v${i}]`);
    video = `[v${i}]`;
  }
  const audioLabels = parts.flatMap((p, i) => (p.hasAudio ? [`[${i}:a]`] : []));
  if (audioLabels.length) filters.push(mix(audioLabels));
  await run(
    opts.ffmpeg,
    // One piece left (the others were unreadable): nothing to blend, so its video is mapped straight.
    ["-y", "-hide_banner", "-nostdin", ...inputs, ...(filters.length ? ["-filter_complex", filters.join(";")] : []), "-map", parts.length > 1 ? video : "0:v",
      ...(audioLabels.length ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : []),
      "-t", duration, ...cappedVideo(opts.videoHeight), "-r", String(FPS),
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
    { timeoutMs },
  );
}

const even = (x: number) => Math.floor(x / 2) * 2;

function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups.values()];
}

/** Fonts tried for tile names when none is configured: Debian's DejaVu (Docker), then macOS. */
export const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
];

export async function findFont(candidates = FONT_CANDIDATES): Promise<string | null> {
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  return null;
}

const MAX_LABEL_CHARS = 32;

/**
 * A drawtext filter (with a leading comma) that writes `name` onto a tile. The name goes
 * through a text file with expansion off, so quotes, colons, % or backslashes in a guest's
 * name can't break or inject into the filter graph. Returns "" if the font path itself
 * can't be quoted safely.
 */
async function nameLabel(font: string, name: string, tile: { w: number; h: number }, centred: boolean, textPath: string) {
  if (font.includes("'") || textPath.includes("'")) return "";
  const clean = name.replace(/[\u0000-\u001f]/g, " ").trim() || "Participant";
  const text = [...clean].length > MAX_LABEL_CHARS ? `${[...clean].slice(0, MAX_LABEL_CHARS - 1).join("")}…` : clean;
  await writeFile(textPath, text);
  const common = `fontfile='${font}':textfile='${textPath}':expansion=none:fontcolor=white`;
  if (centred) {
    const size = Math.max(18, Math.round(tile.h * 0.08));
    return `,drawtext=${common}:fontsize=${size}:x=(w-tw)/2:y=(h-th)/2`;
  }
  const size = Math.max(14, Math.round(tile.h * 0.045));
  const margin = Math.round(size * 0.8);
  return (
    `,drawtext=${common}:fontsize=${size}:box=1:boxcolor=black@0.55:boxborderw=${Math.round(size * 0.35)}` +
    `:x=${margin}:y=h-th-${margin}`
  );
}

/** One tile per participant (their camera, or a dark tile when audio-only), all audio mixed. */
async function renderCombined(
  tracks: TrackInput[],
  rendered: OutputFile[],
  opts: PipelineOptions,
  timeoutMs: number,
): Promise<OutputFile | null> {
  const participants = [...new Set(tracks.map((t) => t.participantId))];
  if (participants.length === 0) return null;
  if (!rendered.some((o) => o.kind === "video")) return renderMix(rendered, opts, timeoutMs);
  const tiles = gridLayout(participants.length);
  const duration = sec(opts.durationMs);
  const args: string[] = [];
  const filters: string[] = [`color=c=black:s=1920x1080:r=${FPS}:d=${duration}[base]`];
  const audioLabels: string[] = [];
  const voices: string[] = [];
  let input = 0;
  let canvas = "base";

  const font = opts.font === undefined ? await findFont() : opts.font;

  for (const [i, pid] of participants.entries()) {
    const tile = tiles[i]!;
    const video = rendered.find((o) => o.participantId === pid && o.kind === "video");
    const audio = rendered.find((o) => o.participantId === pid && o.kind === "audio");
    const name = tracks.find((t) => t.participantId === pid)!.participantName;
    // Name tag like in the room: bottom-left on a camera, centred on an audio-only tile.
    const label = font ? await nameLabel(font, name, tile, !video, join(opts.workDir, `label-${i}.txt`)) : "";
    if (video) {
      args.push("-i", video.path);
      filters.push(
        `[${input}:v]scale=${tile.w}:${tile.h}:force_original_aspect_ratio=decrease,` +
          `pad=${tile.w}:${tile.h}:(ow-iw)/2:(oh-ih)/2:color=${TILE_BG},setsar=1${label}[t${i}]`,
      );
      input++;
    } else {
      filters.push(`color=c=${TILE_BG}:s=${tile.w}x${tile.h}:r=${FPS}:d=${duration}${label}[t${i}]`);
    }
    filters.push(`[${canvas}][t${i}]overlay=x=${tile.x}:y=${tile.y}:shortest=0[c${i}]`);
    canvas = `c${i}`;
    if (audio) voices.push(audio.path);
  }
  // Voices go in after the cameras, so their input numbers follow.
  if (!opts.loudness) {
    for (const path of voices) {
      args.push("-i", path);
      audioLabels.push(`[${input}:a]`);
      input++;
    }
  }

  const mixAudio = voices.length > 0;
  let gainDb: number | undefined;
  if (mixAudio && opts.loudness) {
    // Level the mix as a whole: several levelled voices together are louder than one, and
    // their peaks can add up. Mixed into a float WAV first, which can't clip, to measure it.
    const mixPath = join(opts.workDir, "mix.wav");
    await run(
      opts.ffmpeg,
      ["-y", "-hide_banner", "-nostdin", ...voices.flatMap((p) => ["-i", p]), "-filter_complex",
        voices.length > 1
          ? `${voices.map((_, i) => `[${i}:a]`).join("")}amix=inputs=${voices.length}:normalize=0:dropout_transition=0[a]`
          : "[0:a]anull[a]",
        "-map", "[a]", "-t", duration, "-c:a", "pcm_f32le", mixPath],
      { timeoutMs },
    );
    gainDb = loudnessGain(await measureLoudness(opts.ffmpeg, mixPath, timeoutMs), opts.loudness);
    // The mix replaces the separate voices as the combined video's sound.
    args.push("-i", mixPath);
    filters.push(`[${input}:a]${volumeFilter(gainDb) || "anull"}[a]`);
    input++;
  } else if (audioLabels.length > 1) {
    filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0[a]`);
  } else if (mixAudio) {
    filters.push(`${audioLabels[0]}anull[a]`);
  }

  const path = join(opts.workDir, "combined.mp4");
  await run(
    opts.ffmpeg,
    ["-y", "-hide_banner", "-nostdin", ...args, "-filter_complex", filters.join(";"), "-map", `[${canvas}]`,
      ...(mixAudio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : []),
      "-t", duration, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", String(FPS),
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", path],
    { timeoutMs },
  );
  return { kind: "combined", path, fileName: "Combined.mp4", contentType: "video/mp4",
    durationMs: await probeDurationMs(opts.ffprobe, path), ...(gainDb !== undefined && { gainDb }) };
}

/** Nobody had video (an audio-only show, or everyone's camera off): everyone's voices mixed into one WAV. */
async function renderMix(rendered: OutputFile[], opts: PipelineOptions, timeoutMs: number): Promise<OutputFile | null> {
  const voices = rendered.filter((o) => o.kind === "audio").map((o) => o.path);
  if (voices.length === 0) return null;
  const duration = sec(opts.durationMs);
  const inputs = voices.flatMap((p) => ["-i", p]);
  const mix =
    voices.length > 1
      ? `${voices.map((_, i) => `[${i}:a]`).join("")}amix=inputs=${voices.length}:normalize=0:dropout_transition=0`
      : "[0:a]anull";
  const path = join(opts.workDir, "combined.wav");
  let gainDb: number | undefined;
  if (opts.loudness) {
    // Level the mix as a whole, like the combined video's sound: mixed in float first, measured, then the gain.
    const floatPath = join(opts.workDir, "mix.wav");
    await run(opts.ffmpeg, ["-y", "-hide_banner", "-nostdin", ...inputs, "-filter_complex", `${mix}[a]`, "-map", "[a]",
      "-t", duration, "-c:a", "pcm_f32le", floatPath], { timeoutMs });
    gainDb = loudnessGain(await measureLoudness(opts.ffmpeg, floatPath, timeoutMs), opts.loudness);
    await run(opts.ffmpeg, ["-y", "-hide_banner", "-nostdin", "-i", floatPath, "-af", volumeFilter(gainDb) || "anull",
      "-c:a", "pcm_s16le", path], { timeoutMs });
  } else {
    await run(opts.ffmpeg, ["-y", "-hide_banner", "-nostdin", ...inputs, "-filter_complex", `${mix}[a]`, "-map", "[a]",
      "-t", duration, "-c:a", "pcm_s16le", path], { timeoutMs });
  }
  return { kind: "combined", path, fileName: "Combined.wav", contentType: "audio/wav",
    durationMs: await probeDurationMs(opts.ffprobe, path), ...(gainDb !== undefined && { gainDb }) };
}

// MediaRecorder output has no index and sometimes odd timestamps: regenerate them.
/** What MediaRecorder writes (WebM, or MP4 in Safari): other demuxers never see a guest's bytes. */
export const RAW_FORMATS = "matroska,webm,mov,mp4,m4a";
const INPUT_FLAGS = ["-y", "-hide_banner", "-nostdin", "-fflags", "+genpts", "-format_whitelist", RAW_FORMATS];

/** "Sam", "Sam (2)" when two people share a name; safe for file names everywhere. */
function uniqueNames(tracks: TrackInput[]) {
  const byParticipant = new Map<string, string>();
  const used = new Map<string, number>();
  for (const t of tracks) {
    if (byParticipant.has(t.participantId)) continue;
    const clean = t.participantName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim() || "Participant";
    const n = (used.get(clean) ?? 0) + 1;
    used.set(clean, n);
    byParticipant.set(t.participantId, n === 1 ? clean : `${clean} (${n})`);
  }
  return new Map(tracks.map((t) => [t.trackId, byParticipant.get(t.participantId)!]));
}
