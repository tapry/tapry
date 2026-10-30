import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import { probeDurationMs, probeStreams, run } from "./ffmpeg.js";

export interface TrackInput {
  trackId: string;
  participantId: string;
  participantName: string;
  kind: "audio" | "video";
  /** The track's chunks concatenated in seq order (WebM or MP4 as MediaRecorder wrote it). */
  rawPath: string;
  /** Track start minus recording start, server clock. Positive: the track started late. */
  offsetMs: number;
}

export interface PipelineOptions {
  ffmpeg: string;
  ffprobe: string;
  /** Scratch folder for outputs; the caller uploads and deletes it. */
  workDir: string;
  /** Recording length (Record → Stop). Every output is exactly this long. */
  durationMs: number;
  videoHeight: 720 | 1080;
  /** Per ffmpeg invocation. Default: 10× real time, at least 2 minutes. */
  timeoutMs?: number;
}

export interface OutputFile {
  kind: "audio" | "video" | "combined";
  trackId?: string;
  participantId?: string;
  path: string;
  fileName: string;
  contentType: string;
  durationMs: number | null;
}

const FPS = 30;
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
): string {
  const late = Math.max(0, Math.round(offsetMs));
  const early = Math.max(0, Math.round(-offsetMs));
  if (kind === "audio") {
    return [
      // Time audio by sample count from 0. Container timestamps can start below zero
      // (Opus pre-skip) or jitter, which would make -t cut files a few ms short.
      "aresample=48000,asetpts=N/SR/TB",
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
 * combined grid video with everyone's audio mixed. All aligned to the moment Record was pressed.
 */
export async function renderRecording(tracks: TrackInput[], opts: PipelineOptions): Promise<OutputFile[]> {
  await mkdir(opts.workDir, { recursive: true });
  const timeoutMs = opts.timeoutMs ?? Math.max(120_000, opts.durationMs * 10);
  const duration = sec(opts.durationMs);
  const names = uniqueNames(tracks);
  const outputs: OutputFile[] = [];

  // One file per person per kind. A person can have several tracks of a kind when they
  // rejoined during the recording (tab crash, reload): those pieces are merged in place.
  for (const pieces of groupBy(tracks, (t) => `${t.participantId}\u0000${t.kind}`)) {
    const first = pieces[0]!;
    const base = names.get(first.trackId)!;
    const ext = first.kind === "audio" ? "wav" : "mp4";
    const path = join(opts.workDir, `${first.trackId}.${ext}`);
    if (pieces.length === 1) {
      await renderPiece(first, path, { opts, duration, timeoutMs, multi: false });
    } else {
      const parts: Array<{ path: string; hasAudio: boolean }> = [];
      for (const piece of pieces) {
        const partPath = join(opts.workDir, `${piece.trackId}.part.${ext}`);
        parts.push({ path: partPath, hasAudio: await renderPiece(piece, partPath, { opts, duration, timeoutMs, multi: true }) });
      }
      await mergePieces(first.kind, parts, path, { opts, duration, timeoutMs });
    }
    outputs.push({
      kind: first.kind,
      trackId: first.trackId,
      participantId: first.participantId,
      path,
      fileName: `${base} - ${first.kind}.${ext}`,
      contentType: first.kind === "audio" ? "audio/wav" : "video/mp4",
      durationMs: await probeDurationMs(opts.ffprobe, path),
    });
  }

  const combined = await renderCombined(tracks, outputs, opts, timeoutMs);
  if (combined) outputs.push(combined);
  return outputs;
}

interface RenderContext {
  opts: PipelineOptions;
  duration: string;
  timeoutMs: number;
}

/**
 * Render one track onto the recording timeline. Returns whether it had audio.
 * `multi`: it's one piece of several for the same person, so pad with black rather than
 * freezing the last frame, and use a fixed 16:9 frame so the pieces can be merged.
 */
async function renderPiece(track: TrackInput, path: string, { opts, duration, timeoutMs, multi }: RenderContext & { multi: boolean }) {
  if (track.kind === "audio") {
    await run(
      opts.ffmpeg,
      [...INPUT_FLAGS, "-i", track.rawPath, "-vn", "-af", alignmentFilters("audio", track.offsetMs),
        "-t", duration, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path],
      { timeoutMs },
    );
    return true;
  }
  const hasAudio = (await probeStreams(opts.ffprobe, track.rawPath)).includes("audio");
  const h = opts.videoHeight;
  const frame = multi
    ? `scale=${even((h * 16) / 9)}:${h}:force_original_aspect_ratio=decrease,pad=${even((h * 16) / 9)}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
    : `scale=-2:${h}`;
  await run(
    opts.ffmpeg,
    [...INPUT_FLAGS, "-i", track.rawPath,
      "-vf", `${alignmentFilters("video", track.offsetMs, multi ? "black" : "clone")},${frame},format=yuv420p`,
      ...(hasAudio ? ["-af", alignmentFilters("audio", track.offsetMs), "-c:a", multi ? "pcm_s16le" : "aac", ...(multi ? [] : ["-b:a", "192k"])] : ["-an"]),
      "-t", duration, "-c:v", "libx264", "-preset", "veryfast", "-crf", multi ? "16" : "20", "-r", String(FPS),
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
  { opts, duration, timeoutMs }: RenderContext,
) {
  const inputs = parts.flatMap((p) => ["-i", p.path]);
  const mix = (labels: string[]) =>
    labels.length > 1 ? `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[a]` : `${labels[0]}anull[a]`;
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
    ["-y", "-hide_banner", "-nostdin", ...inputs, "-filter_complex", filters.join(";"), "-map", video,
      ...(audioLabels.length ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : []),
      "-t", duration, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS),
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

/** One tile per participant (their camera, or a dark tile when audio-only), all audio mixed. */
async function renderCombined(
  tracks: TrackInput[],
  rendered: OutputFile[],
  opts: PipelineOptions,
  timeoutMs: number,
): Promise<OutputFile | null> {
  const participants = [...new Set(tracks.map((t) => t.participantId))];
  if (participants.length === 0) return null;
  const tiles = gridLayout(participants.length);
  const duration = sec(opts.durationMs);
  const args: string[] = [];
  const filters: string[] = [`color=c=black:s=1920x1080:r=${FPS}:d=${duration}[base]`];
  const audioLabels: string[] = [];
  let input = 0;
  let canvas = "base";

  participants.forEach((pid, i) => {
    const tile = tiles[i]!;
    const video = rendered.find((o) => o.participantId === pid && o.kind === "video");
    const audio = rendered.find((o) => o.participantId === pid && o.kind === "audio");
    if (video) {
      args.push("-i", video.path);
      filters.push(
        `[${input}:v]scale=${tile.w}:${tile.h}:force_original_aspect_ratio=decrease,` +
          `pad=${tile.w}:${tile.h}:(ow-iw)/2:(oh-ih)/2:color=${TILE_BG},setsar=1[t${i}]`,
      );
      input++;
    } else {
      filters.push(`color=c=${TILE_BG}:s=${tile.w}x${tile.h}:r=${FPS}:d=${duration}[t${i}]`);
    }
    filters.push(`[${canvas}][t${i}]overlay=x=${tile.x}:y=${tile.y}:shortest=0[c${i}]`);
    canvas = `c${i}`;
    if (audio) {
      args.push("-i", audio.path);
      audioLabels.push(`[${input}:a]`);
      input++;
    }
  });

  const mixAudio = audioLabels.length > 0;
  if (audioLabels.length > 1) {
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
    durationMs: await probeDurationMs(opts.ffprobe, path) };
}

// MediaRecorder output has no index and sometimes odd timestamps: regenerate them.
const INPUT_FLAGS = ["-y", "-hide_banner", "-nostdin", "-fflags", "+genpts"];

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
