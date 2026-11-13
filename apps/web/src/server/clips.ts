// Clips: a stretch of a finished recording cut out as a file of its own, from the combined
// video (or the mix of a recording without video). The host names the start and end, usually
// from the transcript; a job cuts it. Not "viral clip" generation: nothing chooses for you.
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
    const [rec] = await this.db.query<{ processing: string; started_at: number; stopped_at: number | null; source: string | null; clips: number }>(
      `SELECT r.processing, r.started_at, r.stopped_at,
              (SELECT o.id FROM outputs o WHERE o.recording_id = r.id AND o.kind = 'combined' LIMIT 1) AS source,
              (SELECT count(*)::int FROM clips c WHERE c.recording_id = r.id) AS clips
       FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.id = $1 AND st.id = $2 AND st.owner_id = $3 AND st.deleted_at IS NULL AND r.deleted_at IS NULL`,
      [recordingId, studioId, user.accountId],
    );
    if (!rec) throw new ApiError(404, "recording_not_found", "Recording not found");
    return rec;
  }

  async create(user: User, studioId: string, recordingId: string, body: { startMs: number; endMs: number; title?: string }): Promise<Clip> {
    const rec = await this.recording(user, studioId, recordingId);
    if (rec.processing !== "ready" || !rec.source || rec.stopped_at === null) throw new ApiError(409, "not_ready", "Clips are cut once the recording's files are ready");
    const length = Number(rec.stopped_at) - Number(rec.started_at);
    const startMs = Math.max(0, Math.round(body.startMs));
    const endMs = Math.min(length, Math.round(body.endMs));
    if (endMs - startMs < CLIP_MIN_MS) throw new ApiError(400, "clip_too_short", "A clip is at least a second long, inside the recording");
    if (endMs - startMs > CLIP_MAX_MS) throw new ApiError(400, "clip_too_long", "A clip is at most ten minutes long");
    if (rec.clips >= MAX_CLIPS) throw new ApiError(429, "too_many_clips", "This recording has all the clips it can hold. Delete one first.");
    const clip: Clip = { id: newId("clp"), startMs, endMs, title: body.title ?? "", status: "queued", output: null };
    await this.db.transaction(async (tx) => {
      await tx.query("INSERT INTO clips (id, recording_id, start_ms, end_ms, title) VALUES ($1, $2, $3, $4, $5)", [clip.id, recordingId, startMs, endMs, clip.title]);
      await queueClips(tx, recordingId);
    });
    this.onQueued();
    return clip;
  }

  async list(user: User, recordingId: string): Promise<Clip[]> {
    const rows = await this.db.query<{ id: string; start_ms: number; end_ms: number; title: string; status: Clip["status"]; output_id: string | null; file_name: string | null; bytes: string | null }>(
      `SELECT c.id, c.start_ms, c.end_ms, c.title, c.status, o.id AS output_id, o.file_name, o.bytes
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
export function clipFileName(clip: { startMs: number; endMs: number; title: string }, ext: string) {
  const at = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    return `${h > 0 ? `${h}.` : ""}${String(Math.floor(s / 60) % 60).padStart(2, "0")}.${String(s % 60).padStart(2, "0")}`;
  };
  const title = clip.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `Clip ${at(clip.startMs)}-${at(clip.endMs)}${title ? ` - ${title}` : ""}.${ext}`;
}

/** ffmpeg arguments that cut [startMs, endMs) out of a finished file, exact to the frame (it is re-encoded). */
export function clipArgs(source: string, out: string, startMs: number, endMs: number, kind: "video" | "wav" | "flac"): string[] {
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  const base = ["-y", "-hide_banner", "-nostdin", "-ss", seconds(startMs), "-i", source, "-t", seconds(endMs - startMs)];
  if (kind === "video") return [...base, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out];
  return [...base, "-vn", "-c:a", kind === "flac" ? "flac" : "pcm_s16le", out];
}
