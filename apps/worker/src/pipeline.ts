import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import { BRIGHTNESS_VALUES, LOOK_VALUES, VIDEO_TIERS, videoTier, type TrackFilters, type VideoHeight, type VideoQuality } from "@tapry/shared";
import { FfmpegError, probeDurationMs, probeFrameTimesMs, probeStreams, probeVideoHeight, run } from "./ffmpeg.js";

export interface TrackInput {
  trackId: string;
  participantId: string;
  participantName: string;
  /**
   * "screen": what the person shared from their display, picture only. Each time they shared is
   * a track of its own; together they become one file, black while nothing was shared.
   */
  kind: "audio" | "video" | "screen";
  /** The track's chunks concatenated in seq order (WebM or MP4 as MediaRecorder wrote it). */
  rawPath: string;
  /** Track start minus recording start, server clock. Positive: the track started late. */
  offsetMs: number;
  /** A chunk is missing from the middle: time the sound by its timestamps, so what follows stays in place. */
  hasGaps?: boolean;
  /**
   * What the person chose for how they look and sound. The upload is untouched: these are
   * applied here, to their files. Left out: the files are as recorded.
   */
  filters?: TrackFilters;
  /** When the track's last chunk ended, minus recording start. Left out: it ran to the end of the recording. */
  endOffsetMs?: number;
  /**
   * For a camera track whose filters blur the background: the mask the person's device recorded
   * with it. Left out, unreadable or not covering the video: the file is rendered without the
   * blur and `onFilterFailed` says so. A mask can only ever add the blur, never cost the file.
   */
  mask?: MaskInput;
}

/** A person's mask track: a small black-and-white video, white where the person is. */
export interface MaskInput {
  /** Its chunks concatenated in seq order, like a track's `rawPath`. */
  rawPath: string;
  /** Mask start minus recording start, server clock (the mask's own, not the camera's). */
  offsetMs: number;
}

/** A track or file left out because ffmpeg couldn't read or render it. */
export interface SkippedTrack {
  trackId?: string;
  participantId?: string;
  participantName?: string;
  kind: "audio" | "video" | "screen" | "combined";
  reason: string;
}

/** A person's file that came out as recorded, because ffmpeg couldn't run their filters on it. */
export interface FilterFailure {
  participantId: string;
  name: string;
  kind: "audio" | "video";
}

export interface PipelineOptions {
  /** A track was left out and the rest rendered without it. */
  onSkipped?: (skipped: SkippedTrack) => void;
  /** A person's filters couldn't be applied to one of their files, which is as recorded instead. Once per file. */
  onFilterFailed?: (failed: FilterFailure) => void;
  ffmpeg: string;
  ffprobe: string;
  /** Scratch folder for outputs; the caller uploads and deletes it. */
  workDir: string;
  /** Recording length (Record → Stop). Every output is exactly this long. */
  durationMs: number;
  /**
   * The studio's video quality. 720p and 1080p: every person's video is that size. 2160p (4K):
   * each person's video keeps the size their camera delivered, up to 4K and never under 1080p.
   */
  videoQuality: VideoQuality;
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
  kind: "audio" | "video" | "screen" | "combined";
  /** A shared screen: when it was shared, in seconds from the recording's start. */
  intervals?: Array<[number, number]>;
  trackId?: string;
  participantId?: string;
  path: string;
  fileName: string;
  contentType: string;
  durationMs: number | null;
  /** Gain applied to level the audio (dB), when loudness levelling is on and the file has sound. */
  gainDb?: number;
  /** The person's sound before noise removal ("Sam - audio (original).wav"), kept next to the cleaned file. */
  original?: boolean;
}

const FPS = 30;
/** The frame a shared screen is kept in (1920×1080), whatever the window's shape. */
const SCREEN_HEIGHT = 1080;

/**
 * Most bits per second a person's processed video may use: what the browser recorded at
 * (apps/web recording.ts). x264 aims for quality (CRF 20) but never spends more than the original
 * had, so noisy or busy footage can't come out bigger than the upload without being better.
 */
export const VIDEO_MAX_BITRATE = Object.fromEntries(VIDEO_TIERS.map((t) => [t.height, t.bitrate])) as Record<VideoHeight, number>;

/** x264 flags for a person's final video: constant quality, capped at the original's bitrate. */
function cappedVideo(height: VideoHeight) {
  const max = VIDEO_MAX_BITRATE[height];
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-maxrate", String(max), "-bufsize", String(max * 2)];
}
const TILE_BG = "0x202020";
/** The sharer's camera in the corner of the combined video while their screen fills it. */
const PIP = { w: 352, h: 198, margin: 28 };

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

/** ffmpeg prints numbers its own way; ours are short and exact ("1.08", never "1.0799999"). */
const num = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * The picture filters a person chose, as an ffmpeg filter chain; "" when there are none, so a
 * track without filters is rendered with exactly the command it always was. The numbers come
 * from the shared tables the live preview uses too.
 * - brightness and look: eq (light, contrast, gamma, saturation; black and white is saturation 0);
 * - warm / cool: colortemperature (not for black and white);
 * - touch-up: a bilateral filter on the luma, which smooths skin and keeps edges.
 * All three exist in ffmpeg 5.1 (Debian bookworm, the Docker image) and later.
 */
export function videoLookFilters(filters: TrackFilters | undefined): string {
  if (!filters) return "";
  const light = BRIGHTNESS_VALUES[filters.brightness];
  const look = LOOK_VALUES[filters.look];
  const chain: string[] = [];
  if (light.brightness !== 0 || light.contrast !== 1 || light.gamma !== 1 || look.saturation !== 1) {
    chain.push(`eq=brightness=${num(light.brightness)}:contrast=${num(light.contrast)}:gamma=${num(light.gamma)}:saturation=${num(look.saturation)}`);
  }
  if (look.saturation !== 0 && look.temperature !== 6500) chain.push(`colortemperature=temperature=${num(look.temperature)}`);
  if (filters.touchUp) chain.push(TOUCH_UP);
  return chain.join(",");
}

/**
 * The longest stretch of a person's video the mask may leave uncovered (before it starts, after
 * it ends, or between two of its frames) and still be used. Where there is no mask the picture
 * could be shown as it is (which shows the room someone asked to hide) or blurred whole (which
 * hides the person, in a file that's meant to show them). Neither is right for long, so: up to
 * a second is blurred whole at the start and end (a recorder starting or stopping its two
 * tracks a moment apart) or keeps the last mask frame in between; anything longer and the mask
 * isn't used at all, the file is rendered without the blur, and the host is told.
 */
export const MASK_MAX_GAP_MS = 1000;

/**
 * The filter graph (-filter_complex, video out as [v]) that blurs a camera's background.
 * Input 0 is the camera, input 1 the mask.
 * - The camera goes through exactly what it does without the blur (look, alignment, scale), so
 *   the same frames come out at the same times; only then is it split into a sharp and a
 *   blurred copy. Black that fills a late start stays black: blurred black is black.
 * - The mask is put on the recording's timeline with its own offset at the same constant frame
 *   rate (it is recorded at fewer frames a second: each one is held), black (nobody there) where
 *   it has no frames, stretched to full contrast, scaled to the picture and softened at the edge.
 * - The sharp copy shows through where the mask is white (alphamerge + overlay, which treats
 *   the colour planes correctly); where it is fully white the pixels are the camera's own.
 * `frame` is what follows for a piece of several (the padding to 16:9), or "".
 */
export function backgroundBlurGraph(o: { look: string; align: string; scale: string; frame: string; maskOffsetMs: number; height: number }): string {
  const late = Math.max(0, Math.round(o.maskOffsetMs));
  const early = Math.max(0, Math.round(-o.maskOffsetMs));
  const mask = [
    "format=gray",
    early ? `trim=start=${sec(early)},setpts=PTS-STARTPTS` : "",
    // From 0, so the first frames of the picture never wait for the mask's first frame.
    `fps=${FPS}:start_time=0`,
    late ? `tpad=start_duration=${sec(late)}:start_mode=add:color=black` : "",
    "tpad=stop=-1:stop_mode=add:color=black",
    // Video compression leaves the white a little grey and the black a little light.
    "lut=y='clip((val-64)*2,0,255)'",
  ]
    .filter(Boolean)
    .join(",");
  return [
    `[0:v]${o.look ? `${o.look},` : ""}${o.align},${o.scale},format=yuv420p,split[sharp][soft]`,
    `[soft]gblur=sigma=${num(o.height / 54)}[bg]`,
    `[1:v]${mask}[mask]`,
    "[mask][sharp]scale2ref=flags=bilinear[fit][person]",
    `[fit]gblur=sigma=${num(o.height / 270)}[edge]`,
    "[person][edge]alphamerge[fg]",
    `[bg][fg]overlay=format=yuv420${o.frame ? `,${o.frame}` : ""},format=yuv420p[v]`,
  ].join(";");
}

/** Touch-up: small sigmas, luma only, so skin evens out while eyes, hair and edges stay sharp. */
const TOUCH_UP = "bilateral=sigmaS=3:sigmaR=0.05:planes=1";

/** What was measured for noise removal: the track's own noise floor, and how much this ffmpeg's filter delays sound. */
export interface NoiseMeasurement {
  /** RMS of the quietest stretches (dBFS); null or left out: not known, a usual room is assumed. */
  noiseFloorDb?: number | null;
  /** Samples (48 kHz) the filter holds sound back by; taken off again so nothing moves. */
  delaySamples?: number;
}

/** Most the noise is turned down (dB): enough to take a fan or hiss out of the way, never the voice with it. */
const NOISE_REDUCTION_DB = 12;
/**
 * afftdn's noise floor setting, from the measured one. It expects the level of the noise it
 * should treat as noise; measured on white, pink and low rumbling noise, 20 dB over the RMS of
 * the quiet stretches takes 9 to 12 dB off each, while a tone 10 dB above the noise loses under 1 dB.
 * Capped, so a track with no quiet stretch (someone talking throughout) isn't treated as noise.
 */
const NOISE_FLOOR_MARGIN_DB = 20;
const NOISE_FLOOR_MAX_DB = -25;
const NOISE_FLOOR_DEFAULT_DB = -50;
const DENOISE = "afftdn";

/**
 * Noise removal as an ffmpeg filter chain; "" when it's off. afftdn takes steady noise (fans,
 * hiss) out by its spectrum. Its noise floor comes from the track itself (`measureNoiseFloor`):
 * the filter's own tracking barely acts on real rooms. Some ffmpeg versions delay the sound by
 * a few ms in this filter (6.0: 25 ms), so that is measured (`filterDelaySamples`) and taken off.
 */
export function audioCleanFilters(filters: TrackFilters | undefined, measured: NoiseMeasurement = {}): string {
  if (!filters?.noiseRemoval) return "";
  const floor = measured.noiseFloorDb;
  const nf = floor === null || floor === undefined
    ? NOISE_FLOOR_DEFAULT_DB
    : Math.max(-80, Math.min(NOISE_FLOOR_MAX_DB, Math.round(floor + NOISE_FLOOR_MARGIN_DB)));
  const delay = Math.max(0, Math.round(measured.delaySamples ?? 0));
  return [
    // Room at the end for what the delay would otherwise push out.
    delay ? `apad=pad_len=${delay}` : "",
    `${DENOISE}=nr=${NOISE_REDUCTION_DB}:nf=${nf}`,
    delay ? `atrim=start_sample=${delay},asetpts=N/SR/TB` : "",
  ]
    .filter(Boolean)
    .join(",");
}

/**
 * The noise floor of one of our WAVs (16-bit mono): the RMS of its quietest tenth of 100 ms
 * windows, in dBFS. Digital silence (padding before a late start, a muted mic) doesn't count.
 * null when there is nothing to measure.
 */
export async function measureNoiseFloor(wavPath: string): Promise<number | null> {
  const WINDOW = 4800;
  const levels: number[] = [];
  let header = Buffer.alloc(0);
  let dataLeft = -1; // bytes of the data chunk still to read; -1 until its header is found
  let carry: Buffer | null = null;
  let sum = 0;
  let count = 0;
  for await (const piece of createReadStream(wavPath, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) {
    let buf = piece;
    if (dataLeft < 0) {
      // Walk the RIFF chunks to "data" (ffmpeg writes a LIST chunk first).
      header = Buffer.concat([header, piece]);
      if (header.length < 12 || header.subarray(0, 4).toString("latin1") !== "RIFF") {
        if (header.length >= 12) return null;
        continue;
      }
      let at = 12;
      while (at + 8 <= header.length && header.subarray(at, at + 4).toString("latin1") !== "data") at += 8 + header.readUInt32LE(at + 4);
      if (at + 8 > header.length) {
        if (header.length > 1 << 22) return null;
        continue;
      }
      dataLeft = header.readUInt32LE(at + 4);
      buf = header.subarray(at + 8);
    }
    if (carry) {
      buf = Buffer.concat([carry, buf]);
      carry = null;
    }
    if (buf.length > dataLeft) buf = buf.subarray(0, dataLeft);
    dataLeft -= buf.length - (buf.length % 2);
    if (buf.length % 2) carry = buf.subarray(buf.length - 1);
    for (let i = 0; i + 1 < buf.length; i += 2) {
      const x = buf.readInt16LE(i);
      sum += x * x;
      if (++count === WINDOW) {
        const rms = Math.sqrt(sum / WINDOW);
        if (rms >= 1) levels.push(rms); // under one step of 16 bits: nothing was recorded there
        sum = 0;
        count = 0;
      }
    }
    if (dataLeft <= 0) break;
  }
  if (levels.length === 0) return null;
  levels.sort((a, b) => a - b);
  const quiet = levels[Math.floor(levels.length * 0.1)]!;
  return Math.round(200 * Math.log10(quiet / 32768)) / 10;
}

const filterDelays = new Map<string, Promise<number>>();

/**
 * How many samples (48 kHz) this ffmpeg's `filter` holds sound back by: a tone that starts at
 * 0.5 s goes through it, and where it starts in the output is compared with the input.
 * Measured once per ffmpeg and filter, since it depends on the version, not the recording.
 */
export function filterDelaySamples(ffmpeg: string, filter: string, workDir: string, timeoutMs?: number): Promise<number> {
  const key = `${ffmpeg}\u0000${filter}`;
  let known = filterDelays.get(key);
  if (!known) {
    known = (async () => {
      const ref = join(workDir, "delay-ref.raw");
      const out = join(workDir, "delay-out.raw");
      try {
        await run(
          ffmpeg,
          ["-y", "-hide_banner", "-nostdin", "-f", "lavfi", "-i", "aevalsrc='if(gte(t,0.5),0.5*sin(2*PI*1000*t),0)':s=48000:d=1",
            "-filter_complex", `[0:a]asplit[r][x];[x]${filter}[c]`,
            "-map", "[r]", "-c:a", "pcm_s16le", "-f", "s16le", ref, "-map", "[c]", "-c:a", "pcm_s16le", "-f", "s16le", out],
          { timeoutMs },
        );
        const onset = async (path: string) => {
          const buf = await readFile(path);
          for (let i = 0; i + 1 < buf.length; i += 2) if (Math.abs(buf.readInt16LE(i)) > 8192) return i / 2;
          return -1;
        };
        const [before, after] = [await onset(ref), await onset(out)];
        return before < 0 || after < before ? 0 : after - before;
      } finally {
        await Promise.all([rm(ref, { force: true }), rm(out, { force: true })]);
      }
    })();
    filterDelays.set(key, known);
    known.catch(() => filterDelays.delete(key));
  }
  return known;
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
  // Likewise the noise floor measured on a person's WAV serves the sound in their video (the same microphone).
  const floors = new Map<string, number | null>();
  const unfiltered = new Set<string>();
  const filterFailed = (t: TrackInput) => {
    const key = `${t.participantId}\u0000${t.kind}`;
    if (unfiltered.has(key)) return;
    unfiltered.add(key);
    opts.onFilterFailed?.({ participantId: t.participantId, name: t.participantName, kind: t.kind === "audio" ? "audio" : "video" });
  };
  const shared = { opts, duration, timeoutMs, filterFailed };
  const groups = groupBy(tracks, (t) => `${t.participantId}\u0000${t.kind}`);
  const byGroup = new Map<TrackInput[], OutputFile[]>();
  let firstFailure: FfmpegError | undefined;
  const skip = (t: TrackInput, err: FfmpegError) => {
    firstFailure ??= err;
    opts.onSkipped?.({ trackId: t.trackId, participantId: t.participantId, participantName: t.participantName, kind: t.kind, reason: failureReason(err) });
  };
  const ORDER = { audio: 0, video: 1, screen: 2 } as const;
  const audioFirst = [...groups].sort((a, b) => ORDER[a[0]!.kind] - ORDER[b[0]!.kind]);

  // One file per person per kind. A person can have several tracks of a kind when they
  // rejoined during the recording (tab crash, reload): those pieces are merged in place.
  for (const [i, pieces] of audioFirst.entries()) {
    const first = pieces[0]!;
    const base = names.get(first.trackId)!;
    opts.onProgress?.({ done: i, total: groups.length + 1, current: `${base}'s ${first.kind}` });
    const ext = first.kind === "audio" ? "wav" : "mp4";
    const path = join(opts.workDir, `${first.trackId}.${ext}`);
    const gainDb = first.kind === "video" ? gains.get(first.participantId) : undefined;
    // In a 4K studio a person's video keeps their camera's size: the tallest of their pieces.
    // A shared screen is always a Full HD frame: windows come in every shape.
    const isScreen = first.kind === "screen";
    const videoHeight = isScreen ? SCREEN_HEIGHT : first.kind === "video" ? await personVideoHeight(pieces, opts) : undefined;
    const ctx = { ...shared, videoHeight };
    let hasAudio: boolean;
    try {
      // A screen goes the way of pieces even when it is one: black before and after it was shared.
      if (pieces.length === 1 && !isScreen) {
        hasAudio = await renderPiece(first, path, { ...ctx, multi: false, gainDb, noiseFloorDb: floors.get(first.participantId) });
      } else {
        const parts: Array<{ path: string; hasAudio: boolean }> = [];
        for (const piece of pieces) {
          const partPath = join(opts.workDir, `${piece.trackId}.part.${ext}`);
          try {
            parts.push({ path: partPath, hasAudio: await renderPiece(piece, partPath, { ...ctx, multi: true, noiseFloorDb: floors.get(first.participantId) }) });
          } catch (err) {
            if (!(err instanceof FfmpegError)) throw err;
            skip(piece, err);
          }
        }
        if (parts.length === 0) continue;
        await mergePieces(first.kind === "audio" ? "audio" : "video", parts, path, { opts, duration, timeoutMs, gainDb, videoHeight });
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
      ...(isScreen && { intervals: pieces.map((p): [number, number] => [Math.max(0, p.offsetMs) / 1000, Math.min(opts.durationMs, p.endOffsetMs ?? opts.durationMs) / 1000]).filter(([a, b]) => b > a) }),
    };
    const files = [output];
    // Noise removal comes before levelling, so the gain is worked out on the cleaned sound.
    // The aligned sound as recorded stays, as a second file, exactly as it would be without filters.
    const cleaned = first.kind === "audio" ? pieces.find((p) => p.filters?.noiseRemoval)?.filters : undefined;
    if (cleaned) {
      const originalPath = join(opts.workDir, `${first.trackId}.original.wav`);
      await rename(path, originalPath);
      try {
        const noiseFloorDb = await measureNoiseFloor(originalPath);
        floors.set(first.participantId, noiseFloorDb);
        const clean = audioCleanFilters(cleaned, { noiseFloorDb, delaySamples: await denoiseDelay(ctx) });
        await run(
          opts.ffmpeg,
          ["-y", "-hide_banner", "-nostdin", "-i", originalPath, "-af", `${clean},apad`, "-t", duration, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path],
          { timeoutMs },
        );
        files.push({ ...output, path: originalPath, fileName: `${base} - audio (original).wav`, original: true });
        output.durationMs = await probeDurationMs(opts.ffprobe, path);
      } catch (err) {
        if (!(err instanceof FfmpegError)) throw err;
        // A filter must never cost someone their file: it stays as recorded, and the host is told.
        await rename(originalPath, path);
        filterFailed(first);
      }
    }
    if (opts.loudness && first.kind === "audio") {
      output.gainDb = await levelWav(path, opts.loudness, { opts, duration, timeoutMs });
      gains.set(first.participantId, output.gainDb);
    } else if (gainDb !== undefined && hasAudio) {
      output.gainDb = gainDb;
    }
    byGroup.set(pieces, files);
  }
  const outputs = groups.flatMap((g) => byGroup.get(g) ?? []);
  // Nothing readable at all: more likely the machine than the media, so the job fails and retries.
  if (outputs.length === 0) throw firstFailure ?? new Error("No tracks to render");

  const hasVideo = outputs.some((o) => o.kind === "video" || o.kind === "screen");
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
  /** The person's noise floor, measured on their WAV, for noise removal on their video's sound. */
  noiseFloorDb?: number | null;
  /** This track's file is as recorded, because its filters couldn't be run. */
  filterFailed?: (track: TrackInput) => void;
  /** The height this person's video is made at (see PipelineOptions.videoQuality). Unset: the studio's own. */
  videoHeight?: VideoHeight;
}

/**
 * The height a person's video is made at. 720p and 1080p studios: the studio's. A 4K studio: the
 * tier of the tallest picture among their pieces, so nothing is upscaled past what the camera
 * gave. A piece that can't be probed counts for nothing here (it is skipped or fails later).
 */
async function personVideoHeight(pieces: TrackInput[], opts: PipelineOptions): Promise<VideoHeight> {
  const top = videoTier(opts.videoQuality).height;
  if (top <= 1080) return top;
  let tallest = 0;
  for (const piece of pieces) tallest = Math.max(tallest, (await probeVideoHeight(opts.ffprobe, piece.rawPath, RAW_FORMATS).catch(() => null)) ?? 0);
  return videoTier(opts.videoQuality, tallest || 1080).height;
}

/** How far this ffmpeg's noise removal delays sound (measured once). */
const denoiseDelay = ({ opts, timeoutMs }: RenderContext) => filterDelaySamples(opts.ffmpeg, `${DENOISE}=nr=${NOISE_REDUCTION_DB}:nf=${NOISE_FLOOR_DEFAULT_DB}`, opts.workDir, timeoutMs);

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
async function renderPiece(track: TrackInput, path: string, ctx: RenderContext & { multi: boolean }): Promise<boolean> {
  const { opts, duration, timeoutMs, multi, gainDb } = ctx;
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
  // The look goes on the camera's own frames, before alignment: the black that fills a late
  // start or the gap between pieces has to stay black (brightness would turn it grey, and
  // merging pieces relies on it). Noise removal: on the aligned sound, like the person's WAV.
  const look = videoLookFilters(track.filters);
  const h = ctx.videoHeight ?? videoTier(opts.videoQuality).height;
  const wide = even((h * 16) / 9);
  const pad = `pad=${wide}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  const frame = multi ? `scale=${wide}:${h}:force_original_aspect_ratio=decrease,${pad}` : `scale=-2:${h}`;
  // A shared screen that stands still sends few frames, so its last one is held to the moment
  // sharing really ended (the last chunk's time) and the picture is black from there.
  const isScreen = track.kind === "screen";
  const shareEnd = isScreen && track.endOffsetMs !== undefined ? `,drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='gte(t,${sec(Math.max(0, track.endOffsetMs))})'` : "";
  const align = alignmentFilters("video", track.offsetMs, multi && !isScreen ? "black" : "clone");
  // Background blur needs a mask that covers this video; without one the file is made without it.
  const wantsBlur = track.filters?.background === "blur";
  const mask = wantsBlur ? await usableMask(track, ctx) : null;
  try {
    let clean = "";
    if (hasAudio && track.filters?.noiseRemoval) {
      let noiseFloorDb = ctx.noiseFloorDb;
      if (noiseFloorDb === undefined) {
        // No WAV of theirs to go by (the camera track carries the only sound): measure this track's.
        const sound = `${path}.sound.wav`;
        try {
          await run(
            opts.ffmpeg,
            [...INPUT_FLAGS, "-i", track.rawPath, "-vn", "-af", alignmentFilters("audio", track.offsetMs, "clone", track.hasGaps),
              "-t", duration, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", sound],
            { timeoutMs },
          );
          noiseFloorDb = await measureNoiseFloor(sound);
        } finally {
          await rm(sound, { force: true });
        }
      }
      clean = audioCleanFilters(track.filters, { noiseFloorDb, delaySamples: await denoiseDelay(ctx) });
    }
    const picture = mask
      ? [...RAW_INPUT_FLAGS, "-i", mask.rawPath,
          "-filter_complex", backgroundBlurGraph({
            look, align, height: h, maskOffsetMs: mask.offsetMs,
            // An even size before the padding, for the colour planes of the mask.
            scale: multi ? `scale=${wide}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2` : frame,
            frame: multi ? pad : "",
          }),
          "-map", "[v]", ...(hasAudio ? ["-map", "0:a:0"] : [])]
      : ["-vf", `${look ? `${look},` : ""}${align},${frame}${shareEnd},format=yuv420p`];
    await run(
      opts.ffmpeg,
      [...INPUT_FLAGS, "-i", track.rawPath,
        ...picture,
        ...(hasAudio ? ["-af", [alignmentFilters("audio", track.offsetMs, "clone", track.hasGaps), clean, volumeFilter(gainDb)].filter(Boolean).join(","), "-c:a", multi ? "pcm_s16le" : "aac", ...(multi ? [] : ["-b:a", "192k"])] : ["-an"]),
        // A piece of several is an intermediate (merged next), so it stays near-lossless and uncapped.
        "-t", duration, ...(multi ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16"] : cappedVideo(h)), "-r", String(FPS),
        ...(multi ? ["-f", "mov"] : ["-movflags", "+faststart"]), path],
      { timeoutMs },
    );
  } catch (err) {
    if (!(err instanceof FfmpegError)) throw err;
    // A filter this ffmpeg can't run, or a mask it can't read, must never cost someone their
    // file: first without the blur (their look stays), then as recorded.
    if (mask) return renderPiece({ ...track, mask: undefined }, path, ctx);
    if (!(look || track.filters?.noiseRemoval)) throw err;
    const rendered = await renderPiece({ ...track, filters: undefined }, path, ctx);
    // Only now: had it failed again, the track is unreadable (skipped), not the filters.
    ctx.filterFailed?.(track);
    return rendered;
  }
  // The file is there, without the blur its person asked for.
  if (wantsBlur && !mask) ctx.filterFailed?.(track);
  return hasAudio;
}

/**
 * The track's mask, when it can be trusted for the whole of this video: readable, and leaving
 * no more than MASK_MAX_GAP_MS uncovered at the start, the end, or between two of its frames
 * (see there for why). Its frame times are read from the file itself, not taken on trust.
 */
async function usableMask(track: TrackInput, { opts }: RenderContext): Promise<MaskInput | null> {
  const mask = track.mask;
  if (!mask) return null;
  let times: number[];
  try {
    times = await probeFrameTimesMs(opts.ffprobe, mask.rawPath, RAW_FORMATS);
  } catch (err) {
    if (!(err instanceof FfmpegError)) throw err;
    return null;
  }
  if (times.length < 2) return null;
  const videoStart = Math.max(0, track.offsetMs);
  const videoEnd = Math.min(track.endOffsetMs ?? opts.durationMs, opts.durationMs);
  if (mask.offsetMs + times[0]! - videoStart > MASK_MAX_GAP_MS) return null;
  if (videoEnd - (mask.offsetMs + times.at(-1)!) > MASK_MAX_GAP_MS) return null;
  for (let i = 1; i < times.length; i++) if (times[i]! - times[i - 1]! > MASK_MAX_GAP_MS) return null;
  return mask;
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
  { opts, duration, timeoutMs, gainDb, videoHeight }: RenderContext,
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
      "-t", duration, ...cappedVideo(videoHeight ?? videoTier(opts.videoQuality).height), "-r", String(FPS),
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
  if (!rendered.some((o) => o.kind === "video" || o.kind === "screen")) return renderMix(rendered, opts, timeoutMs);
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
    const audio = rendered.find((o) => o.participantId === pid && o.kind === "audio" && !o.original);
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
  // While someone shares their screen it fills the frame, with their camera small in a corner;
  // the grid is back when they stop. (The screen's file is black outside those times.)
  for (const [j, screen] of rendered.filter((o) => o.kind === "screen" && o.intervals?.length).entries()) {
    const when = screen.intervals!.map(([a, b]) => `between(t,${num(a)},${num(b)})`).join("+");
    args.push("-i", screen.path);
    filters.push(`[${input}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[s${j}]`);
    filters.push(`[${canvas}][s${j}]overlay=x=0:y=0:shortest=0:enable='${when}'[cs${j}]`);
    canvas = `cs${j}`;
    input++;
    const camera = rendered.find((o) => o.participantId === screen.participantId && o.kind === "video");
    if (camera) {
      args.push("-i", camera.path);
      filters.push(`[${input}:v]scale=${PIP.w}:${PIP.h}:force_original_aspect_ratio=decrease,pad=${PIP.w}:${PIP.h}:(ow-iw)/2:(oh-ih)/2:color=${TILE_BG},setsar=1[p${j}]`);
      filters.push(`[${canvas}][p${j}]overlay=x=${1920 - PIP.w - PIP.margin}:y=${1080 - PIP.h - PIP.margin}:shortest=0:enable='${when}'[cp${j}]`);
      canvas = `cp${j}`;
      input++;
    }
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
  const voices = rendered.filter((o) => o.kind === "audio" && !o.original).map((o) => o.path);
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
const RAW_INPUT_FLAGS = ["-fflags", "+genpts", "-format_whitelist", RAW_FORMATS];
const INPUT_FLAGS = ["-y", "-hide_banner", "-nostdin", ...RAW_INPUT_FLAGS];

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
