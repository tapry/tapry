// Clips: a stretch of a finished recording cut out as a file of its own, from the combined
// video (or the mix of a recording without video). The host names the start and end, usually
// from the transcript; a job cuts it. Not "viral clip" generation: nothing chooses for you.
import type { ClipShape } from "@tapry/shared";
import type { User } from "./auth";
import type { Db, Queryable } from "./db";
import { ApiError } from "./errors";
import { newId } from "./ids";

export const CLIP_MIN_MS = 1000;
export const CLIP_MAX_MS = 10 * 60 * 1000;
export const MAX_CLIPS = 50;

export interface Clip {
  id: string;
  startMs: number;
  endMs: number;
  title: string;
  /** wide: cut from the combined video. square, vertical: built again from each person's camera. */
  shape: ClipShape;
  /** What is said, written on the picture. */
  captions: boolean;
  status: "queued" | "ready" | "failed";
  /** The finished file, once there is one. */
  output: { id: string; fileName: string; bytes: number } | null;
}

export class ClipsService {
  constructor(
    private db: Db,
    private storage: { delete(keys: string[]): Promise<unknown> },
    private onQueued: () => void = () => {},
  ) {}

  private async recording(user: User, studioId: string, recordingId: string) {
    const [rec] = await this.db.query<{ processing: string; transcript: string; started_at: number; stopped_at: number | null; source: string | null; source_name: string | null; cameras: number; clips: number }>(
      `SELECT r.processing, r.transcript, r.started_at, r.stopped_at,
              (SELECT o.id FROM outputs o WHERE o.recording_id = r.id AND o.kind = 'combined' LIMIT 1) AS source,
              (SELECT o.file_name FROM outputs o WHERE o.recording_id = r.id AND o.kind = 'combined' LIMIT 1) AS source_name,
              (SELECT count(*)::int FROM outputs o WHERE o.recording_id = r.id AND o.kind = 'video') AS cameras,
              (SELECT count(*)::int FROM clips c WHERE c.recording_id = r.id) AS clips
       FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.id = $1 AND st.id = $2 AND st.owner_id = $3 AND st.deleted_at IS NULL AND r.deleted_at IS NULL`,
      [recordingId, studioId, user.accountId],
    );
    if (!rec) throw new ApiError(404, "recording_not_found", "Recording not found");
    return rec;
  }

  async create(user: User, studioId: string, recordingId: string, body: { startMs: number; endMs: number; title?: string; shape?: ClipShape; captions?: boolean }): Promise<Clip> {
    const rec = await this.recording(user, studioId, recordingId);
    if (rec.processing !== "ready" || !rec.source || rec.stopped_at === null) throw new ApiError(409, "not_ready", "Clips are cut once the recording's files are ready");
    const length = Number(rec.stopped_at) - Number(rec.started_at);
    const startMs = Math.max(0, Math.round(body.startMs));
    const endMs = Math.min(length, Math.round(body.endMs));
    if (endMs - startMs < CLIP_MIN_MS) throw new ApiError(400, "clip_too_short", "A clip is at least a second long, inside the recording");
    if (endMs - startMs > CLIP_MAX_MS) throw new ApiError(400, "clip_too_long", "A clip is at most ten minutes long");
    if (rec.clips >= MAX_CLIPS) throw new ApiError(429, "too_many_clips", "This recording has all the clips it can hold. Delete one first.");
    const shape = body.shape ?? "wide";
    const captions = body.captions ?? false;
    const hasPicture = !!rec.source_name?.toLowerCase().endsWith(".mp4");
    if (shape !== "wide" && rec.cameras === 0) throw new ApiError(400, "no_cameras", "Square and vertical clips are built from people's cameras, and nobody had one on in this recording.");
    if (captions && !hasPicture) throw new ApiError(400, "no_picture", "Captions are written on the picture, and this recording has none.");
    if (captions && rec.transcript !== "ready") throw new ApiError(409, "no_transcript", "Captions come from the transcript, and this recording doesn't have one yet.");
    const clip: Clip = { id: newId("clp"), startMs, endMs, title: body.title ?? "", shape, captions, status: "queued", output: null };
    await this.db.transaction(async (tx) => {
      await tx.query("INSERT INTO clips (id, recording_id, start_ms, end_ms, title, shape, captions) VALUES ($1, $2, $3, $4, $5, $6, $7)", [clip.id, recordingId, startMs, endMs, clip.title, shape, captions]);
      await queueClips(tx, recordingId);
    });
    this.onQueued();
    return clip;
  }

  async list(user: User, recordingId: string): Promise<Clip[]> {
    const rows = await this.db.query<{ id: string; start_ms: number; end_ms: number; title: string; shape: ClipShape; captions: boolean; status: Clip["status"]; output_id: string | null; file_name: string | null; bytes: string | null }>(
      `SELECT c.id, c.start_ms, c.end_ms, c.title, c.shape, c.captions, c.status, o.id AS output_id, o.file_name, o.bytes
       FROM clips c JOIN recordings r ON r.id = c.recording_id JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       LEFT JOIN outputs o ON o.id = c.output_id
       WHERE c.recording_id = $1 AND st.owner_id = $2 AND r.deleted_at IS NULL AND st.deleted_at IS NULL
       ORDER BY c.start_ms, c.created_at`,
      [recordingId, user.accountId],
    );
    return rows.map((r) => ({
      id: r.id,
      startMs: Number(r.start_ms),
      endMs: Number(r.end_ms),
      title: r.title,
      shape: r.shape,
      captions: r.captions,
      status: r.status,
      output: r.output_id ? { id: r.output_id, fileName: r.file_name!, bytes: Number(r.bytes) } : null,
    }));
  }

  /** Remove a clip and its file. */
  async remove(user: User, studioId: string, recordingId: string, clipId: string) {
    await this.recording(user, studioId, recordingId);
    const key = await this.db.transaction(async (tx) => {
      const [clip] = await tx.query<{ output_id: string | null }>("DELETE FROM clips WHERE id = $1 AND recording_id = $2 RETURNING output_id", [clipId, recordingId]);
      if (!clip) throw new ApiError(404, "clip_not_found", "Clip not found");
      if (!clip.output_id) return null;
      const [out] = await tx.query<{ storage_key: string }>("DELETE FROM outputs WHERE id = $1 RETURNING storage_key", [clip.output_id]);
      return out?.storage_key ?? null;
    });
    if (key) await this.storage.delete([key]).catch(() => {});
  }
}

/** Queue the job that cuts a recording's waiting clips (one job does them all). */
export async function queueClips(db: Queryable, recordingId: string) {
  await db.query(
    `INSERT INTO jobs (id, type, recording_id) VALUES ($1, 'clip_recording', $2)
     ON CONFLICT (recording_id, type) WHERE status IN ('queued', 'running') DO NOTHING`,
    [newId("job"), recordingId],
  );
}

/** "Clip 01.05-02.30 - The hard year.mp4": sortable by where it starts, readable in a folder. */
export function clipFileName(clip: { startMs: number; endMs: number; title: string; shape?: ClipShape }, ext: string) {
  const at = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    return `${h > 0 ? `${h}.` : ""}${String(Math.floor(s / 60) % 60).padStart(2, "0")}.${String(s % 60).padStart(2, "0")}`;
  };
  const title = clip.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const shape = clip.shape && clip.shape !== "wide" ? ` (${clip.shape})` : "";
  return `Clip ${at(clip.startMs)}-${at(clip.endMs)}${title ? ` - ${title}` : ""}${shape}.${ext}`;
}

/** ffmpeg arguments that cut [startMs, endMs) out of a finished file, exact to the frame (it is re-encoded). */
export function clipArgs(source: string, out: string, startMs: number, endMs: number, kind: "video" | "wav" | "flac"): string[] {
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  const base = ["-y", "-hide_banner", "-nostdin", "-ss", seconds(startMs), "-i", source, "-t", seconds(endMs - startMs)];
  if (kind === "video") return [...base, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out];
  return [...base, "-vn", "-c:a", kind === "flac" ? "flac" : "pcm_s16le", out];
}

// ── Shapes and captions ──────────────────────────────────────────────────────

/** The frame of each shape. */
export const CLIP_FRAMES: Record<ClipShape, { w: number; h: number }> = { wide: { w: 1920, h: 1080 }, square: { w: 1080, h: 1080 }, vertical: { w: 1080, h: 1920 } };

/**
 * Where each of `n` people goes in a frame: the arrangement of rows and columns whose tiles
 * are nearest a camera's own shape (16:9), so as little of each picture as possible is cut
 * away. Two people in a vertical frame are one above the other, not two slivers side by side.
 */
export function clipTiles(n: number, frame: { w: number; h: number }): Array<{ x: number; y: number; w: number; h: number }> {
  const even = (v: number) => Math.floor(v / 2) * 2;
  let best = { cols: 1, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const score = Math.abs(Math.log(frame.w / cols / (frame.h / rows) / (16 / 9)));
    if (score < best.score - 1e-9) best = { cols, score };
  }
  const rows = Math.ceil(n / best.cols);
  const w = even(frame.w / best.cols);
  const h = even(frame.h / rows);
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / best.cols);
    // A last row with fewer people is centred.
    const inRow = row === rows - 1 ? n - row * best.cols : best.cols;
    return { x: Math.floor((frame.w - inRow * w) / 2) + (i % best.cols) * w, y: row * h, w, h };
  });
}

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
}

/** Words on screen at once: short enough to read at a glance on a phone. */
const CAPTION_CHARS = 36;

/**
 * The captions of [startMs, endMs) as an ASS subtitle file for ffmpeg to draw: white text with
 * a dark outline near the bottom. A transcript's lines are whole sentences, so each is shown
 * a few words at a time, each part for its share of the line's time (the transcript has no
 * time per word, so within a line this is an estimate).
 */
export function captionsAss(cues: CaptionCue[], startMs: number, endMs: number, shape: ClipShape): string {
  const frame = CLIP_FRAMES[shape];
  const size = Math.round(frame.w * (shape === "wide" ? 0.03 : 0.052));
  const margin = Math.round(frame.h * (shape === "vertical" ? 0.16 : 0.07));
  const stamp = (ms: number) => {
    const cs = Math.max(0, Math.round(ms / 10));
    const two = (v: number) => String(v).padStart(2, "0");
    return `${Math.floor(cs / 360000)}:${two(Math.floor(cs / 6000) % 60)}:${two(Math.floor(cs / 100) % 60)}.${two(cs % 100)}`;
  };
  // Nothing in the words may read as formatting: braces start an override, a backslash an escape.
  const plain = (text: string) => text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
  const events: string[] = [];
  for (const cue of cues) {
    const from = Math.max(cue.startMs, startMs);
    const to = Math.min(cue.endMs, endMs);
    if (to - from < 150) continue;
    const words = plain(cue.text).split(" ").filter(Boolean);
    const parts: string[] = [];
    for (const word of words) {
      const last = parts.at(-1);
      if (last !== undefined && last.length + 1 + word.length <= CAPTION_CHARS) parts[parts.length - 1] = `${last} ${word}`;
      else parts.push(word);
    }
    const total = parts.reduce((sum, p) => sum + p.length, 0) || 1;
    // The line's own span, of which only [from, to) is inside the clip.
    let at = cue.startMs;
    for (const part of parts) {
      const until = at + ((cue.endMs - cue.startMs) * part.length) / total;
      const a = Math.max(at, from);
      const b = Math.min(until, to);
      if (b - a >= 100) events.push(`Dialogue: 0,${stamp(a - startMs)},${stamp(b - startMs)},Caption,,0,0,0,,${part}`);
      at = until;
    }
  }
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${frame.w}`,
    `PlayResY: ${frame.h}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,Inter,${size},&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(size / 14))},1,2,${Math.round(frame.w * 0.06)},${Math.round(frame.w * 0.06)},${margin},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

/** A path as ffmpeg's filter syntax takes it inside quotes. */
const filterPath = (path: string) => path.replace(/\\/g, "/").replace(/'/g, "'\\''").replace(/:/g, "\\:");

/**
 * ffmpeg arguments for a clip with a picture. Wide: cut from the combined video, as before,
 * with the captions drawn on it when asked. Square and vertical: each person's camera cut to
 * the same stretch, cropped to fill its tile, with the sound of the combined video (everyone,
 * levelled). `people`: each person's finished video, in the order they appear.
 */
export function shapedClipArgs(o: { combined: string; people: string[]; out: string; startMs: number; endMs: number; shape: ClipShape; ass?: string | null; fps?: string }): string[] {
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  const cut = ["-ss", seconds(o.startMs), "-t", seconds(o.endMs - o.startMs)];
  const encode = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", o.out];
  const captions = o.ass ? `ass='${filterPath(o.ass)}'` : "";
  if (o.shape === "wide") {
    return ["-y", "-hide_banner", "-nostdin", ...cut, "-i", o.combined, "-t", seconds(o.endMs - o.startMs), ...(captions ? ["-vf", captions] : []), ...encode];
  }
  const frame = CLIP_FRAMES[o.shape];
  const tiles = clipTiles(o.people.length, frame);
  const length = seconds(o.endMs - o.startMs);
  const filters = [`color=c=0x202020:s=${frame.w}x${frame.h}:r=${o.fps ?? "30"}:d=${length}[base]`];
  let canvas = "base";
  o.people.forEach((_, i) => {
    const t = tiles[i]!;
    // Filled, not letterboxed: the middle of each camera, where the person is.
    filters.push(`[${i + 1}:v]scale=${t.w}:${t.h}:force_original_aspect_ratio=increase,crop=${t.w}:${t.h},setsar=1[t${i}]`);
    filters.push(`[${canvas}][t${i}]overlay=x=${t.x}:y=${t.y}:shortest=0[c${i}]`);
    canvas = `c${i}`;
  });
  filters.push(`[${canvas}]${captions ? `${captions},` : ""}format=yuv420p[v]`);
  return [
    "-y", "-hide_banner", "-nostdin",
    ...cut, "-i", o.combined,
    ...o.people.flatMap((p) => [...cut, "-i", p]),
    "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", "0:a:0?", "-t", length,
    ...encode,
  ];
}
