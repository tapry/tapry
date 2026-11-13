import { studioSettings, type OwnRecordings } from "@tapry/shared";
import type { User } from "./auth";
import type { Db, Queryable } from "./db";
import { ApiError } from "./errors";
import { newId } from "./ids";
import type { Participant } from "./live";
import type { Storage } from "./storage";

/** See `maybeEnqueue`: the most a mask still uploading holds processing back. */
export const MASK_GRACE_MS = 15_000;

export type ProcessingStatus = "pending" | "queued" | "processing" | "ready" | "failed";

/** A running job's step: collecting the uploads, rendering file `done + 1` of `total`, saving, transcribing. */
export interface RecordingProgress {
  stage: "collecting" | "rendering" | "saving" | "transcribing";
  done: number;
  total: number;
  /** "Sam's audio": the file or person being worked on. */
  current: string | null;
}

export interface RecordingSummary {
  id: string;
  /** "Recording 41": numbered per studio, in the order they were recorded. */
  number: number;
  sessionId: string;
  status: "recording" | "stopped";
  processing: ProcessingStatus;
  processingError: string | null;
  /** People's tracks left out of the files because they couldn't be read. Their uploads are kept. */
  skippedTracks: Array<{ name: string; kind: "audio" | "video" | "screen" }>;
  /** off: transcription not configured on this server. */
  transcript: "off" | "queued" | "processing" | "ready" | "failed";
  startedAt: number;
  stoppedAt: number | null;
  tracks: number;
  /** Tracks whose upload isn't confirmed yet (a guest may still be uploading, or gone). */
  incompleteTracks: number;
  /** The processing timeline (ms since 1970): when each step finished, null until it has. */
  uploadedAt: number | null;
  processingStartedAt: number | null;
  processedAt: number | null;
  transcribedAt: number | null;
  /** What the running job is doing now, for a progress bar; null when no job runs. */
  progress: RecordingProgress | null;
  /** Space used in storage: uploaded chunks plus processed files. */
  bytes: number;
  /** The original uploads were removed after the retention period; only the processed files remain. */
  rawDeleted: boolean;
  /** Tapry Cloud: when this recording is deleted under its plan (ms since 1970). Null: kept until someone deletes it. */
  keepUntil: number | null;
  /** Someone in it chose filters (look, touch-up, noise removal), so the files can be made with or without. */
  hasFilters: boolean;
  /** Whether processing applies people's filters (default), or leaves the files as recorded. */
  applyFilters: boolean;
  /** Files of the last run that are as recorded because that person's filters couldn't be applied. */
  filtersFailed: Array<{ name: string; kind: "audio" | "video" }>;
  /** Everyone who recorded in it, host first, with how far their upload got. */
  people: Array<{
    participantId: string;
    name: string;
    role: "host" | "guest";
    tracks: number;
    /** Tracks whose upload the server has confirmed complete. */
    completeTracks: number;
    bytes: number;
  }>;
  outputs: Array<{ id: string; kind: "audio" | "video" | "screen" | "combined" | "transcript"; fileName: string; bytes: number; durationMs: number | null }>;
}

/** A recording seen across all of a host's studios (the dashboard's Recordings, Guests, Transcripts). */
export interface OwnedRecording extends RecordingSummary {
  studioId: string;
  studioName: string;
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
    /** How long processing waits for a mask that is still uploading once everything else is in. */
    private maskGraceMs = MASK_GRACE_MS,
  ) {}

  /**
   * Queue processing once the recording has stopped and every media track (sound, camera) is
   * fully uploaded. Called after Stop and after each track completes, so the last upload triggers it.
   *
   * Masks (background blur) never decide this. One still uploading only holds the start back
   * by MASK_GRACE_MS, since it usually lands a moment after its camera track and rendering
   * twice costs more than waiting; after that the files are made without it (that person's
   * blur is reported as not applied). When it does arrive, this is called again like for any
   * late track, and the files are made again with it.
   */
  async maybeEnqueue(recordingId: string) {
    const [r] = await this.db.query<{ status: string; tracks: number; open: number; open_masks: number }>(
      `SELECT r.status,
              (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id AND t.kind <> 'mask') AS tracks,
              (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id AND t.kind <> 'mask' AND t.status = 'recording') AS open,
              (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id AND t.kind = 'mask' AND t.status = 'recording') AS open_masks
       FROM recordings r WHERE r.id = $1 AND r.deleted_at IS NULL AND r.raw_deleted_at IS NULL`,
      [recordingId],
    );
    if (r?.status === "stopped" && r.tracks > 0 && r.open === 0) {
      // Everyone's upload is in (the first time only: a late re-upload doesn't move it).
      await this.db.query("UPDATE recordings SET uploaded_at = coalesce(uploaded_at, now()) WHERE id = $1", [recordingId]);
      await this.enqueue(recordingId, { rerunIfRunning: true, delayMs: r.open_masks > 0 ? this.maskGraceMs : 0 });
    }
  }

  /**
   * Queue (or re-queue) processing with whatever has arrived. A no-op while a job is open, except
   * that `rerunIfRunning` has a running job go again: it has already read its chunks, and a late
   * track would otherwise be missing from "ready" files with nothing to say so.
   */
  async enqueue(recordingId: string, opts: { rerunIfRunning?: boolean; /** Start no sooner than this (waiting for a mask). */ delayMs?: number } = {}) {
    const delayMs = opts.delayMs ?? 0;
    // The row lock orders this against a job finishing, so the request can't fall between the two.
    const inserted = await this.db.transaction(async (tx) => {
      await tx.query("SELECT 1 FROM recordings WHERE id = $1 FOR UPDATE", [recordingId]);
      const rows = await tx.query(
        `INSERT INTO jobs (id, type, recording_id, run_after) VALUES ($1, 'process_recording', $2, now() + make_interval(secs => $3))
         ON CONFLICT (recording_id, type) WHERE status IN ('queued', 'running') DO NOTHING RETURNING id`,
        [newId("job"), recordingId, delayMs / 1000],
      );
      if (rows.length === 0 && delayMs === 0) {
        // Nothing left to wait for (the mask arrived, or the host said go): a job that was waiting starts now.
        await tx.query(
          `UPDATE jobs SET run_after = now() WHERE recording_id = $1 AND type = 'process_recording'
             AND status = 'queued' AND attempts = 0 AND run_after > now()`,
          [recordingId],
        );
      }
      if (rows.length === 0 && opts.rerunIfRunning) {
        await tx.query(
          `UPDATE recordings SET rerun_requested = true WHERE id = $1 AND EXISTS (
             SELECT 1 FROM jobs WHERE recording_id = $1 AND type = 'process_recording' AND status = 'running')`,
          [recordingId],
        );
      }
      return rows;
    });
    if (inserted.length === 0) {
      if (delayMs === 0) this.onEnqueue();
      return;
    }
    const [rec] = await this.db.query<{ session_id: string }>(
      "UPDATE recordings SET processing = 'queued', processing_error = NULL WHERE id = $1 RETURNING session_id",
      [recordingId],
    );
    if (rec) this.onChange(rec.session_id);
    if (delayMs === 0) this.onEnqueue();
    else setTimeout(() => this.onEnqueue(), delayMs + 100).unref?.();
  }

  /** Host presses "Process now": go ahead without the tracks that never finished uploading. */
  async processNow(owner: User, studioId: string, recordingId: string, opts: { filters?: boolean } = {}) {
    const rec = await this.ownedRecording(owner, studioId, recordingId);
    if (rec.status !== "stopped") throw new ApiError(409, "still_recording", "Stop the recording first");
    if (rec.raw_deleted_at) {
      throw new ApiError(409, "originals_removed", "The original uploads were removed after the retention period, so this recording can't be processed again");
    }
    if (opts.filters !== undefined) {
      const [changed] = await this.db.query<{ session_id: string }>(
        "UPDATE recordings SET apply_filters = $2 WHERE id = $1 AND apply_filters <> $2 RETURNING session_id",
        [recordingId, opts.filters],
      );
      if (changed) this.onChange(changed.session_id);
    }
    // A run already under way read the old choice when it started, so it goes again after.
    await this.enqueue(recordingId, { rerunIfRunning: opts.filters !== undefined });
  }

  /**
   * Host deletes a recording: it leaves the list at once, its chunks and files are removed
   * from storage by a purge job. Refused while it is still recording or a worker is on it.
   */
  async deleteRecording(owner: User, studioId: string, recordingId: string) {
    await this.ownedRecording(owner, studioId, recordingId);
    const sessionId = await this.db.transaction((tx) => deleteRecordingIn(tx, recordingId));
    this.onChange(sessionId);
    this.onEnqueue();
  }

  async listForStudio(owner: User, studioId: string): Promise<RecordingSummary[]> {
    const rows = await this.summaries(owner, { studioId, limit: 100 });
    return rows.map(({ studioId: _studio, studioName: _name, ...r }) => r);
  }

  /** The host's recordings across all their studios (or one), newest first. Read-only. */
  async listForOwner(owner: User, opts: { studioId?: string; limit?: number } = {}): Promise<OwnedRecording[]> {
    return this.summaries(owner, { studioId: opts.studioId, limit: Math.max(1, Math.min(opts.limit ?? 200, 500)) });
  }

  /** One of the host's recordings, from any of their studios; 404 for anyone else's. */
  async getForOwner(owner: User, recordingId: string): Promise<OwnedRecording> {
    const [r] = await this.summaries(owner, { recordingId, limit: 1 });
    if (!r) throw new ApiError(404, "recording_not_found", "Recording not found");
    return r;
  }

  private async summaries(owner: User, filter: { studioId?: string; recordingId?: string; limit: number }): Promise<OwnedRecording[]> {
    const rows = await this.db.query<{
      id: string;
      studio_id: string;
      studio_name: string;
      number: number | null;
      raw_deleted_at: Date | null;
      keep_until: Date | null;
      session_id: string;
      status: "recording" | "stopped";
      processing: ProcessingStatus;
      processing_error: string | null;
      skipped_tracks: RecordingSummary["skippedTracks"];
      transcript: RecordingSummary["transcript"];
      started_at: number;
      stopped_at: number | null;
      uploaded_at: Date | null;
      processing_started_at: Date | null;
      processed_at: Date | null;
      transcribed_at: Date | null;
      progress: RecordingProgress | null;
      tracks: number;
      incomplete: number;
      bytes: number;
      apply_filters: boolean;
      has_filters: boolean;
      filters_failed: RecordingSummary["filtersFailed"];
    }>(
      `SELECT r.id, st.id AS studio_id, st.name AS studio_name, r.number, r.raw_deleted_at, r.keep_until, r.session_id, r.status, r.processing, r.processing_error, r.skipped_tracks, r.transcript, r.started_at, r.stopped_at,
              r.uploaded_at, r.processing_started_at, r.processed_at, r.transcribed_at, r.progress,
              (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id AND t.kind <> 'mask') AS tracks,
              (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id AND t.kind <> 'mask' AND t.status = 'recording') AS incomplete,
              r.apply_filters, r.filters_failed, EXISTS (SELECT 1 FROM tracks t WHERE t.recording_id = r.id AND t.filters IS NOT NULL) AS has_filters,
              ${RECORDING_BYTES} AS bytes
       FROM recordings r
       JOIN sessions s ON s.id = r.session_id
       JOIN studios st ON st.id = s.studio_id
       WHERE st.owner_id = $1 AND st.deleted_at IS NULL AND r.deleted_at IS NULL
         AND ($2::text IS NULL OR st.id = $2) AND ($3::text IS NULL OR r.id = $3)
       ORDER BY r.started_at DESC, r.number DESC
       LIMIT $4`,
      [owner.accountId, filter.studioId ?? null, filter.recordingId ?? null, filter.limit],
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
       ORDER BY (o.kind = 'combined') DESC, (o.kind = 'transcript'), p.created_at, o.kind, ${ORIGINAL_LAST}, o.file_name`,
      [rows.map((r) => r.id)],
    );
    const people = await this.db.query<{
      recording_id: string;
      participant_id: string;
      display_name: string;
      role: "host" | "guest";
      tracks: number;
      complete: number;
      bytes: number;
    }>(
      `SELECT t.recording_id, p.id AS participant_id, p.display_name, p.role,
              count(DISTINCT t.id)::int AS tracks,
              count(DISTINCT t.id) FILTER (WHERE t.status <> 'recording')::int AS complete,
              coalesce(sum(c.bytes), 0)::bigint AS bytes
       FROM tracks t JOIN participants p ON p.id = t.participant_id LEFT JOIN chunks c ON c.track_id = t.id
       WHERE t.recording_id = ANY($1::text[]) AND t.kind <> 'mask'
       GROUP BY t.recording_id, p.id, p.display_name, p.role, p.created_at
       ORDER BY (p.role = 'host') DESC, p.created_at`,
      [rows.map((r) => r.id)],
    );
    return rows.map((r) => ({
      id: r.id,
      studioId: r.studio_id,
      studioName: r.studio_name,
      number: r.number ?? 0,
      rawDeleted: r.raw_deleted_at !== null,
      keepUntil: r.keep_until?.getTime() ?? null,
      hasFilters: r.has_filters,
      applyFilters: r.apply_filters,
      filtersFailed: r.filters_failed,
      people: people
        .filter((p) => p.recording_id === r.id)
        .map((p) => ({
          participantId: p.participant_id,
          name: p.display_name,
          role: p.role,
          tracks: p.tracks,
          completeTracks: p.complete,
          bytes: p.bytes,
        })),
      sessionId: r.session_id,
      status: r.status,
      processing: r.processing,
      processingError: r.processing_error,
      skippedTracks: r.skipped_tracks,
      transcript: r.transcript,
      startedAt: r.started_at,
      stoppedAt: r.stopped_at,
      uploadedAt: ms(r.uploaded_at),
      processingStartedAt: ms(r.processing_started_at),
      processedAt: ms(r.processed_at),
      transcribedAt: ms(r.transcribed_at),
      progress: r.progress,
      tracks: r.tracks,
      incompleteTracks: r.incomplete,
      bytes: r.bytes,
      outputs: outputs
        .filter((o) => o.recording_id === r.id)
        .map((o) => ({ id: o.id, kind: o.kind, fileName: o.file_name, bytes: o.bytes, durationMs: o.duration_ms })),
    }));
  }

  /**
   * Everything a processed recording produced, for one zip: file names, sizes and storage
   * keys, plus a name for the zip ("My Podcast - 2026-10-30 19.59 UTC.zip").
   */
  /**
   * Who agreed to be recorded in this recording, when, and to which text (with its SHA-256), as a
   * plain-text file the host can keep with the recording (an ethics board asks for exactly this).
   */
  async consentRecord(owner: User, studioId: string, recordingId: string) {
    const [rec] = await this.db.query<{ number: number | null; started_at: number; stopped_at: number | null; studio_name: string; host: string }>(
      `SELECT r.number, r.started_at, r.stopped_at, st.name AS studio_name, u.name AS host FROM recordings r
       JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id JOIN users u ON u.id = st.owner_id
       WHERE r.id = $1 AND st.id = $2 AND st.owner_id = $3 AND st.deleted_at IS NULL AND r.deleted_at IS NULL`,
      [recordingId, studioId, owner.accountId],
    );
    if (!rec) throw new ApiError(404, "recording_not_found", "Recording not found");
    // Everyone recorded in this recording.
    const people = await this.db.query<{ display_name: string; role: "host" | "guest"; consented_at: Date | null; consent_hash: string | null; text: string | null }>(
      `SELECT p.display_name, p.role, p.consented_at, p.consent_hash, c.text
       FROM participants p LEFT JOIN consent_texts c ON c.hash = p.consent_hash
       WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.recording_id = $1 AND t.participant_id = p.id AND t.kind <> 'mask')
       ORDER BY (p.role = 'host') DESC, p.created_at`,
      [recordingId],
    );
    const iso = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`; // to the second
    const lines = [
      `Consent record: ${rec.studio_name}, Recording ${rec.number ?? "?"}`,
      `Recorded ${iso(rec.started_at)} to ${rec.stopped_at ? iso(rec.stopped_at) : "(still recording)"} (UTC)`,
      `Host: ${rec.host}`,
      "",
    ];
    const texts = new Map<string, string>();
    for (const p of people) {
      if (p.role === "host") {
        lines.push(`${p.display_name} (host): runs the recording.`);
      } else if (p.consent_hash && p.text !== null) {
        texts.set(p.consent_hash, p.text);
        lines.push(`${p.display_name} (guest): agreed ${iso(new Date(p.consented_at!).getTime())}, to text SHA-256 ${p.consent_hash}`);
      } else {
        // Joined before consent texts were kept: the checkbox was required, the text wasn't stored.
        lines.push(`${p.display_name} (guest): agreed ${p.consented_at ? iso(new Date(p.consented_at).getTime()) : "(time not recorded)"}, to the default text of the time (not kept)`);
      }
    }
    for (const [hash, text] of texts) lines.push("", `Text SHA-256 ${hash}:`, text);
    const body = `${lines.join("\n")}\n`;
    return { fileName: `Consent record - Recording ${rec.number ?? "?"}.txt`, body };
  }

  async zipContents(owner: User, studioId: string, recordingId: string) {
    const [rec] = await this.db.query<{ processing: ProcessingStatus; started_at: number; studio_name: string }>(
      `SELECT r.processing, r.started_at, st.name AS studio_name FROM recordings r
       JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.id = $1 AND st.id = $2 AND st.owner_id = $3 AND st.deleted_at IS NULL AND r.deleted_at IS NULL`,
      [recordingId, studioId, owner.accountId],
    );
    if (!rec) throw new ApiError(404, "recording_not_found", "Recording not found");
    if (rec.processing !== "ready") throw new ApiError(409, "not_ready", "This recording hasn't been processed yet");
    const files = await this.db.query<{ file_name: string; bytes: number; storage_key: string; created_at: Date }>(
      `SELECT o.file_name, o.bytes, o.storage_key, o.created_at
       FROM outputs o LEFT JOIN participants p ON p.id = o.participant_id
       WHERE o.recording_id = $1
       ORDER BY (o.kind = 'combined') DESC, (o.kind = 'transcript'), p.created_at, o.kind, ${ORIGINAL_LAST}, o.file_name`,
      [recordingId],
    );
    const started = new Date(rec.started_at).toISOString(); // 2026-10-30T19:59:…Z
    return {
      fileName: `${rec.studio_name} - ${started.slice(0, 10)} ${started.slice(11, 13)}.${started.slice(14, 16)} UTC.zip`,
      files: files.map((f) => ({ name: f.file_name, size: f.bytes, key: f.storage_key, lastModified: new Date(f.created_at) })),
      consent: await this.consentRecord(owner, studioId, recordingId),
    };
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

  /**
   * A participant's own files from their session, for the end screen: only theirs (never the
   * combined video or anyone else's), only when the studio allows it, as links valid for an hour.
   */
  async ownRecordings(p: Participant, promoUrl: string | null): Promise<OwnRecordings> {
    const [studio] = await this.db.query<{ settings: unknown }>(
      "SELECT st.settings FROM sessions s JOIN studios st ON st.id = s.studio_id WHERE s.id = $1 AND st.deleted_at IS NULL",
      [p.sessionId],
    );
    const downloads = !!studio && studioSettings.parse(studio.settings).guestDownloads;
    if (!downloads) return { downloads: false, recordings: [], promoUrl };
    const recordings = await this.db.query<{ id: string; number: number; processing: OwnRecordings["recordings"][number]["processing"] }>(
      `SELECT r.id, r.number, r.processing FROM recordings r
       WHERE r.session_id = $1 AND r.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM tracks t WHERE t.recording_id = r.id AND t.participant_id = $2 AND t.kind <> 'mask')
       ORDER BY r.started_at`,
      [p.sessionId, p.id],
    );
    const out: OwnRecordings["recordings"] = [];
    for (const r of recordings) {
      const files =
        r.processing !== "ready"
          ? []
          : await this.db.query<{ kind: "audio" | "video" | "screen"; file_name: string; content_type: string; storage_key: string; bytes: string }>(
              `SELECT kind, file_name, content_type, storage_key, bytes FROM outputs
               WHERE recording_id = $1 AND participant_id = $2 AND kind IN ('audio', 'video', 'screen') ORDER BY kind, ${ORIGINAL_LAST.replace("o.", "")}`,
              [r.id, p.id],
            );
      out.push({
        number: r.number,
        processing: r.processing,
        files: await Promise.all(
          files.map(async (f) => ({
            kind: f.kind,
            fileName: f.file_name,
            bytes: Number(f.bytes),
            url: await this.storage.presignGet(f.storage_key, { fileName: f.file_name, contentType: f.content_type, ttlSeconds: 3600 }),
          })),
        ),
      });
    }
    return { downloads, recordings: out, promoUrl };
  }

  private async ownedRecording(owner: User, studioId: string, recordingId: string) {
    const [rec] = await this.db.query<{ status: string; raw_deleted_at: Date | null }>(
      `SELECT r.status, r.raw_deleted_at FROM recordings r
       JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.id = $1 AND st.id = $2 AND st.owner_id = $3 AND st.deleted_at IS NULL AND r.deleted_at IS NULL`,
      [recordingId, studioId, owner.accountId],
    );
    if (!rec) throw new ApiError(404, "recording_not_found", "Recording not found");
    return rec;
  }
}

const ms = (d: Date | null) => (d ? new Date(d).getTime() : null);

/** ORDER BY term (outputs as o): a person's sound before noise removal ("… - audio (original).wav") after their cleaned file. */
const ORIGINAL_LAST = "(o.file_name LIKE '% - audio (original).%')";

/** Bytes a recording (alias r) takes in storage: its uploaded chunks (masks too: they take space) plus its processed files. */
export const RECORDING_BYTES = `(
  (SELECT coalesce(sum(c.bytes), 0) FROM chunks c JOIN tracks t ON t.id = c.track_id WHERE t.recording_id = r.id) +
  (SELECT coalesce(sum(o.bytes), 0) FROM outputs o WHERE o.recording_id = r.id)
)::bigint`;

/**
 * Marks a recording deleted inside `tx` and queues the purge of its files; returns its session.
 * The rows that name stored objects (chunks, outputs) go now, so usage drops at once; the
 * recording's and tracks' rows stay so late uploads get 410 Gone (see migration 4).
 */
export async function deleteRecordingIn(tx: Queryable, recordingId: string): Promise<string> {
  const [rec] = await tx.query<{ session_id: string; status: string; deleted_at: Date | null }>(
    "SELECT session_id, status, deleted_at FROM recordings WHERE id = $1 FOR UPDATE",
    [recordingId],
  );
  if (!rec) throw new ApiError(404, "recording_not_found", "Recording not found");
  if (rec.deleted_at) return rec.session_id;
  if (rec.status === "recording") throw new ApiError(409, "still_recording", "Stop the recording before deleting it");

  // Drop work not started yet. A job a worker claimed meanwhile is 'running' when this
  // re-checks the row, so it survives this and the check below refuses.
  await tx.query(
    `DELETE FROM jobs WHERE recording_id = $1 AND type <> 'purge_recording'
       AND (status IN ('queued', 'done', 'failed') OR (status = 'running' AND locked_until < now()))`,
    [recordingId],
  );
  const [busy] = await tx.query("SELECT 1 FROM jobs WHERE recording_id = $1 AND status = 'running' AND type <> 'purge_recording'", [
    recordingId,
  ]);
  if (busy) {
    throw new ApiError(409, "processing_busy", "This recording is being processed right now. Delete it once that finishes.");
  }

  await tx.query("DELETE FROM chunks WHERE track_id IN (SELECT id FROM tracks WHERE recording_id = $1)", [recordingId]);
  await tx.query("DELETE FROM outputs WHERE recording_id = $1", [recordingId]);
  await tx.query("UPDATE recordings SET deleted_at = now() WHERE id = $1", [recordingId]);
  // Nothing of theirs left to send: their address and link go too.
  await tx.query(
    `DELETE FROM recap_requests q WHERE q.session_id = $1 AND NOT EXISTS (
       SELECT 1 FROM tracks t JOIN recordings r ON r.id = t.recording_id
       WHERE t.participant_id = q.participant_id AND t.kind <> 'mask' AND r.deleted_at IS NULL)`,
    [rec.session_id],
  );
  await tx.query(
    `INSERT INTO jobs (id, type, recording_id) VALUES ($1, 'purge_recording', $2)
     ON CONFLICT (recording_id, type) WHERE status IN ('queued', 'running') DO NOTHING`,
    [newId("job"), recordingId],
  );
  return rec.session_id;
}
