import type { User } from "./auth";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { newId } from "./ids";
import type { Storage } from "./storage";

export type ProcessingStatus = "pending" | "queued" | "processing" | "ready" | "failed";

export interface RecordingSummary {
  id: string;
  sessionId: string;
  status: "recording" | "stopped";
  processing: ProcessingStatus;
  processingError: string | null;
  /** off: transcription not configured on this server. */
  transcript: "off" | "queued" | "processing" | "ready" | "failed";
  startedAt: number;
  stoppedAt: number | null;
  tracks: number;
  /** Tracks whose upload isn't confirmed yet (a guest may still be uploading, or gone). */
  incompleteTracks: number;
  outputs: Array<{ id: string; kind: "audio" | "video" | "combined" | "transcript"; fileName: string; bytes: number; durationMs: number | null }>;
}

/**
 * Turning a stopped recording into downloadable files: deciding when it's ready to
 * process, queueing the job, and serving the results. The work itself is JobRunner's.
 */
export class ProcessingService {
  /** Set by the in-process JobRunner so new jobs start without waiting for the next poll. */
  onEnqueue: () => void = () => {};

  constructor(
    private db: Db,
    private storage: Storage,
    private onChange: (sessionId: string) => void = () => {},
  ) {}

  /**
   * Queue processing once the recording has stopped and every track is fully uploaded.
   * Called after Stop and after each track completes, so the last upload triggers it.
   */
  async maybeEnqueue(recordingId: string) {
    const [r] = await this.db.query<{ status: string; tracks: number; open: number }>(
      `SELECT r.status,
              (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id) AS tracks,
              (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id AND t.status = 'recording') AS open
       FROM recordings r WHERE r.id = $1`,
      [recordingId],
    );
    if (r?.status === "stopped" && r.tracks > 0 && r.open === 0) await this.enqueue(recordingId);
  }

  /** Queue (or re-queue) processing with whatever has arrived. A no-op while a job is open. */
  async enqueue(recordingId: string) {
    const inserted = await this.db.query(
      `INSERT INTO jobs (id, type, recording_id) VALUES ($1, 'process_recording', $2)
       ON CONFLICT (recording_id, type) WHERE status IN ('queued', 'running') DO NOTHING RETURNING id`,
      [newId("job"), recordingId],
    );
    if (inserted.length === 0) return;
    const [rec] = await this.db.query<{ session_id: string }>(
      "UPDATE recordings SET processing = 'queued', processing_error = NULL WHERE id = $1 RETURNING session_id",
      [recordingId],
    );
    if (rec) this.onChange(rec.session_id);
    this.onEnqueue();
  }

  /** Host presses "Process now": go ahead without the tracks that never finished uploading. */
  async processNow(owner: User, studioId: string, recordingId: string) {
    const rec = await this.ownedRecording(owner, studioId, recordingId);
    if (rec.status !== "stopped") throw new ApiError(409, "still_recording", "Stop the recording first");
    await this.enqueue(recordingId);
  }

  async listForStudio(owner: User, studioId: string): Promise<RecordingSummary[]> {
    const rows = await this.db.query<{
      id: string;
      session_id: string;
      status: "recording" | "stopped";
      processing: ProcessingStatus;
      processing_error: string | null;
      transcript: RecordingSummary["transcript"];
      started_at: number;
      stopped_at: number | null;
      tracks: number;
      incomplete: number;
    }>(
      `SELECT r.id, r.session_id, r.status, r.processing, r.processing_error, r.transcript, r.started_at, r.stopped_at,
              (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id) AS tracks,
              (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id AND t.status = 'recording') AS incomplete
       FROM recordings r
       JOIN sessions s ON s.id = r.session_id
       JOIN studios st ON st.id = s.studio_id
       WHERE st.id = $1 AND st.owner_id = $2
       ORDER BY r.started_at DESC
       LIMIT 100`,
      [studioId, owner.id],
    );
    if (rows.length === 0) return [];
    const outputs = await this.db.query<{
      id: string;
      recording_id: string;
      kind: RecordingSummary["outputs"][number]["kind"];
      file_name: string;
      bytes: number;
      duration_ms: number | null;
    }>(
      `SELECT o.id, o.recording_id, o.kind, o.file_name, o.bytes, o.duration_ms
       FROM outputs o LEFT JOIN participants p ON p.id = o.participant_id
       WHERE o.recording_id = ANY($1::text[])
       ORDER BY (o.kind = 'combined') DESC, (o.kind = 'transcript'), p.created_at, o.kind, o.file_name`,
      [rows.map((r) => r.id)],
    );
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      status: r.status,
      processing: r.processing,
      processingError: r.processing_error,
      transcript: r.transcript,
      startedAt: r.started_at,
      stoppedAt: r.stopped_at,
      tracks: r.tracks,
      incompleteTracks: r.incomplete,
      outputs: outputs
        .filter((o) => o.recording_id === r.id)
        .map((o) => ({ id: o.id, kind: o.kind, fileName: o.file_name, bytes: o.bytes, durationMs: o.duration_ms })),
    }));
  }

  /** Signed, short-lived storage URL that downloads the file under its friendly name. */
  async downloadUrl(owner: User, studioId: string, recordingId: string, outputId: string) {
    await this.ownedRecording(owner, studioId, recordingId);
    const [o] = await this.db.query<{ storage_key: string; file_name: string; content_type: string }>(
      "SELECT storage_key, file_name, content_type FROM outputs WHERE id = $1 AND recording_id = $2",
      [outputId, recordingId],
    );
    if (!o) throw new ApiError(404, "output_not_found", "File not found");
    return this.storage.presignGet(o.storage_key, { fileName: o.file_name, contentType: o.content_type });
  }

  private async ownedRecording(owner: User, studioId: string, recordingId: string) {
    const [rec] = await this.db.query<{ status: string }>(
      `SELECT r.status FROM recordings r
       JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.id = $1 AND st.id = $2 AND st.owner_id = $3`,
      [recordingId, studioId, owner.id],
    );
    if (!rec) throw new ApiError(404, "recording_not_found", "Recording not found");
    return rec;
  }
}
