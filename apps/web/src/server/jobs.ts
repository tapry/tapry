import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { studioSettings, trackFilters, type TrackFilters } from "@tapry/shared";
import {
  concatChunks,
  FfmpegError,
  mergeSpeakers,
  PODCAST_LOUDNESS,
  renderRecording,
  run as runFfmpeg,
  type FilterFailure,
  type MaskInput,
  type SkippedTrack,
  toDocx,
  toSrt,
  toTxt,
  toVtt,
  transcribeAudio,
  type SpeakerTranscript,
  type TrackInput,
  type WhisperOptions,
} from "@tapry/worker";
import { EXPIRY_NOTICE_MS, planRetention, warnExpiring } from "./billing";
import type { Db, Queryable } from "./db";
import { isApiError } from "./errors";
import { clipArgs, clipFileName } from "./clips";
import { newId } from "./ids";
import { NOTES_ERROR_TEXT, NOTES_FILE, NOTES_MAX_CHARS, NotesError, notesModelFor, notesModels, queueNotes, type NotesConfig, type NotesModel } from "./notes";
import { deleteRecordingIn, type RecordingProgress } from "./processing";
import { sendDueRecaps, sweepRecaps, type RecapMail } from "./recap";
import { APP_VERSION, freeBytes, gatherWorkerInfo, type WorkerInfo } from "./worker-info";

/** "Sam - audio.wav" or "Sam - audio.flac" → the speaker. */
const AUDIO_SUFFIX = / - audio\.(wav|flac)$/;
/** "Sam - audio (original).wav": the same person before noise removal, never a second speaker. */
const ORIGINAL_AUDIO = / - audio \(original\)\.(wav|flac)$/;

/** How often a cloud runner looks for recordings whose keeping time is over. */
const EXPIRY_SWEEP_MS = 10 * 60_000;

/** How often a runner says it's alive (the health page calls it gone after 3 missed beats). */
export const HEARTBEAT_MS = 30_000;
import { UPLOAD_URL_TTL_S, type Storage } from "./storage";

export interface JobRunnerOptions {
  ffmpeg: string;
  ffprobe: string;
  /** How often to look for work when nothing kicked us. */
  pollMs?: number;
  maxAttempts?: number;
  /**
   * A claimed job goes back to the queue if its worker stops renewing the lock for this
   * long (crash, kill -9, lost machine). Renewed every minute while the job runs.
   */
  lockMs?: number;
  /** Delete a recording's original uploads this long after it's processed. Unset: keep them. */
  rawRetentionMs?: number;
  /**
   * Tapry Cloud: each host's plan says how long originals and finished files are kept
   * (instead of rawRetentionMs), and recordings past their time are deleted.
   */
  cloud?: boolean;
  /** Inside the web server, or a separate worker process (shown on the admin health page). */
  kind?: "inprocess" | "worker";
  /** Called after every poll; the standalone worker uses it as its health heartbeat. */
  onPoll?: () => void;
  /** Something changed for this session (status shown to the host). */
  onChange?: (sessionId: string) => void;
  /** Font file for names on the combined video. Unset: found automatically. */
  font?: string;
  /** Transcription; leave out to turn it off. */
  whisper?: Omit<WhisperOptions, "ffmpeg">;
  /**
   * A deleted recording's files are purged at once and again this long after, once every
   * upload URL signed before the delete has expired. Default: upload URL lifetime + 1 min.
   */
  purgeRepeatMs?: number;
  /** Guests' recap emails; leave out when the server doesn't send email. */
  mail?: RecapMail | null;
  /** AI notes: the models this server may use. Left out: no notes. */
  notes?: NotesConfig;
  /** The notes models themselves, instead of building them from `notes` (tests). */
  notesModels?: { local: NotesModel | null; outside: NotesModel | null };
}

type JobType = "process_recording" | "transcribe_recording" | "purge_recording" | "purge_raw" | "notes_recording" | "clip_recording";
type MediaJobType = Exclude<JobType, "purge_recording" | "purge_raw" | "notes_recording" | "clip_recording">;

interface JobRow {
  id: string;
  type: JobType;
  recording_id: string;
  attempts: number;
}

interface RecordingRow {
  id: string;
  session_id: string;
  started_at: number;
  stopped_at: number | null;
  settings: unknown;
}

/** Which recordings column shows a job type's progress. */
const STATUS_COLUMN: Record<MediaJobType, "processing" | "transcript"> = {
  process_recording: "processing",
  transcribe_recording: "transcript",
};

/**
 * Takes jobs from Postgres: process_recording (chunks → files) and transcribe_recording
 * (per-person WAVs → transcript). Several
 * runners (processes, machines) can share one database: claims use SKIP LOCKED.
 */
export class JobRunner {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private stopped = false;
  private kicked = false;
  private current: JobRow | null = null;
  private beat: ReturnType<typeof setInterval> | undefined;
  private info: Promise<WorkerInfo> | undefined;
  private nextRecapSweep = 0;
  private nextExpirySweep = 0;
  /** This runner in the `workers` table. */
  readonly id = newId("wrk");

  constructor(
    private db: Db,
    private storage: Storage,
    private opts: JobRunnerOptions,
  ) {}

  start() {
    this.stopped = false;
    this.schedule(0);
    void this.heartbeat();
    clearInterval(this.beat);
    this.beat = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
  }

  /** Stop taking new jobs. A job already running finishes. */
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.beat);
    void this.db.query("DELETE FROM workers WHERE id = $1", [this.id]).catch(() => {});
  }

  /** "Alive, and this is what I can do": read by the admin health page. Best effort. */
  async heartbeat() {
    try {
      const info = await (this.info ??= gatherWorkerInfo({ ffmpeg: this.opts.ffmpeg, ffprobe: this.opts.ffprobe, whisper: this.opts.whisper }));
      const current = { ...info, tmpFreeBytes: await freeBytes() };
      await this.db.query(
        `INSERT INTO workers (id, kind, version, info) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET info = EXCLUDED.info, version = EXCLUDED.version, seen_at = now()`,
        [this.id, this.opts.kind ?? "worker", APP_VERSION, JSON.stringify(current)],
      );
      await this.db.query("DELETE FROM workers WHERE seen_at < now() - interval '1 day'");
    } catch (err) {
      console.error("[worker] heartbeat failed:", String(err));
    }
  }

  /**
   * For a worker process that is about to exit: stop, and hand a running job straight back
   * to the queue (not as a failed attempt) so another worker starts it now, instead of
   * waiting for the lock to expire. Rendering is idempotent, so redoing it is safe.
   */
  async shutdown() {
    this.stop();
    const job = this.current;
    if (!job) return null;
    await this.db.query(
      `UPDATE jobs SET status = 'queued', locked_until = NULL, run_after = now(), attempts = GREATEST(attempts - 1, 0)
       WHERE id = $1 AND status = 'running'`,
      [job.id],
    );
    if (job.type === "clip_recording") {
      // Its clips are still waiting: nothing to mark.
    } else if (job.type === "notes_recording") {
      await this.db.query("UPDATE recordings SET notes = 'queued' WHERE id = $1", [job.recording_id]);
    } else if (job.type !== "purge_recording" && job.type !== "purge_raw") {
      await this.db.query(`UPDATE recordings SET ${STATUS_COLUMN[job.type]} = 'queued' WHERE id = $1`, [job.recording_id]);
    }
    return job.id;
  }

  /** Look for work now (a job was just queued). */
  kick() {
    if (this.busy) this.kicked = true;
    else this.schedule(0);
  }

  /** Process queued jobs until none are left. Exposed for tests and the CLI. */
  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      do {
        this.kicked = false;
        for (let job = await this.claim(); job && !this.stopped; job = await this.claim()) {
          this.current = job;
          try {
            await this.process(job);
          } finally {
            this.current = null;
          }
        }
        if (!this.stopped) await this.recaps();
        if (!this.stopped) await this.expire();
      } while (this.kicked && !this.stopped);
    } finally {
      this.busy = false;
    }
  }

  /** Email is never why a recording's work stops: a problem here waits for the next poll. */
  private async recaps() {
    try {
      if (this.opts.mail) await sendDueRecaps(this.db, this.opts.mail);
      if (Date.now() >= this.nextRecapSweep) {
        this.nextRecapSweep = Date.now() + 3_600_000;
        await sweepRecaps(this.db);
      }
    } catch (err) {
      console.error("[recap] failed:", err instanceof Error ? err.name : "unknown");
    }
  }

  /**
   * Tapry Cloud: delete recordings whose plan's keeping time is over (`keep_until`), the same
   * way a host deletes one. Never one that is still recording or being processed: it waits.
   */
  private async expire() {
    // Every server: a studio can set its own keeping time. Tapry Cloud adds the plans'.
    if (Date.now() < this.nextExpirySweep) return;
    this.nextExpirySweep = Date.now() + EXPIRY_SWEEP_MS;
    try {
      // Where the server sends email, the host is told first, and a recording goes only once
      // that warning is a day old: a mail problem delays deleting, never the other way round.
      const mail = this.opts.mail;
      if (mail && this.opts.cloud) await warnExpiring(this.db, mail);
      // Without Tapry Cloud there are no plans: a date only counts where the studio itself
      // asks for recordings to be deleted (a date left over from a plan is never acted on).
      const due = await this.db.query<{ id: string; session_id: string }>(
        `SELECT r.id, r.session_id FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
         WHERE r.keep_until IS NOT NULL AND r.keep_until < now() AND r.deleted_at IS NULL AND r.status = 'stopped'
           AND ($2::boolean OR (st.settings->>'deleteAfterDays') IS NOT NULL)
           AND ($1::float8 IS NULL OR r.expiry_warned_at < now() - make_interval(secs => $1::float8))
         ORDER BY r.keep_until LIMIT 50`,
        [mail && this.opts.cloud ? EXPIRY_NOTICE_MS / 1000 : null, !!this.opts.cloud],
      );
      for (const r of due) {
        try {
          await this.db.transaction((tx) => deleteRecordingIn(tx, r.id));
          console.log(`[worker] deleted ${r.id}: its keeping time is over`);
          this.kicked = true; // the purge job
          this.opts.onChange?.(r.session_id);
        } catch (err) {
          if (!isApiError(err)) throw err; // busy: next sweep
        }
      }
    } catch (err) {
      console.error("[worker] expiry sweep failed:", String(err));
    }
  }

  /** Queue the processing asked for while a run was under way. */
  private async rerunIfRequested(recordingId: string) {
    const again = await this.db.query("UPDATE recordings SET rerun_requested = false WHERE id = $1 AND rerun_requested RETURNING id", [recordingId]);
    if (again.length === 0) return;
    await this.db.query(
      `INSERT INTO jobs (id, type, recording_id) VALUES ($1, 'process_recording', $2)
       ON CONFLICT (recording_id, type) WHERE status IN ('queued', 'running') DO NOTHING`,
      [newId("job"), recordingId],
    );
    await this.db.query("UPDATE recordings SET processing = 'queued', processing_error = NULL WHERE id = $1", [recordingId]);
    this.kicked = true;
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try {
        await this.drain();
        this.opts.onPoll?.();
      } catch (err) {
        console.error("[worker] poll failed", err);
      }
      this.schedule(this.opts.pollMs ?? 5000);
    }, ms);
  }

  private async claim(): Promise<JobRow | null> {
    const lockSeconds = this.lockSeconds();
    return this.db.transaction(async (tx) => {
      const [job] = await tx.query<JobRow>(
        `SELECT id, type, recording_id, attempts FROM jobs
         WHERE (status = 'queued' AND run_after <= now()) OR (status = 'running' AND locked_until < now())
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!job) return null;
      await tx.query(
        `UPDATE jobs SET status = 'running', attempts = attempts + 1,
                locked_until = now() + make_interval(secs => $2) WHERE id = $1`,
        [job.id, lockSeconds],
      );
      return { ...job, attempts: job.attempts + 1 };
    });
  }

  private async process(job: JobRow) {
    if (job.type === "purge_recording") return this.purge(job);
    if (job.type === "purge_raw") return this.purgeRaw(job);
    if (job.type === "notes_recording") return this.writeNotes(job);
    if (job.type === "clip_recording") return this.cutClips(job);
    const [rec] = await this.db.query<RecordingRow>(
      `SELECT r.id, r.session_id, r.started_at, r.stopped_at, st.settings
       FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [job.recording_id],
    );
    if (!rec) {
      await this.db.query("UPDATE jobs SET status = 'done', finished_at = now() WHERE id = $1", [job.id]);
      return;
    }
    const column = STATUS_COLUMN[job.type as MediaJobType];
    await this.db.query(
      job.type === "process_recording"
        ? `UPDATE recordings SET ${column} = 'processing', processing_started_at = now(), progress = NULL, rerun_requested = false WHERE id = $1`
        : `UPDATE recordings SET ${column} = 'processing', progress = NULL WHERE id = $1`,
      [rec.id],
    );
    this.opts.onChange?.(rec.session_id);

    // Keep the claim alive for as long as the work takes (transcribing a long recording on a
    // small CPU can outlast any fixed lock); a dead worker stops renewing and loses it.
    const renew = setInterval(() => {
      this.db
        .query(
          "UPDATE jobs SET locked_until = now() + make_interval(secs => $2) WHERE id = $1 AND status = 'running'",
          [job.id, this.lockSeconds()],
        )
        .catch((err) => console.error(`[worker] could not renew the lock on ${job.id}`, err));
    }, Math.min(60_000, (this.lockSeconds() * 1000) / 3));
    const work = await mkdtemp(join(tmpdir(), "tapry-job-"));
    const started = Date.now();
    try {
      if (job.type === "process_recording") await this.processRecording(rec, work, job);
      else await this.transcribeRecording(rec, work, job);
      console.log(`[worker] ${job.type} ${job.id} for ${rec.id} done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (err) {
      // Logs and the database get the reason only, never media.
      const reason = err instanceof FfmpegError ? `${err.message}: ${err.stderrTail.split("\n").slice(-3).join(" ")}` : String(err);
      console.error(`[worker] ${job.type} ${job.id} attempt ${job.attempts} failed:`, reason);
      const finalAttempt = job.attempts >= (this.opts.maxAttempts ?? 3);
      await this.db.query(
        finalAttempt
          ? "UPDATE jobs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1"
          : "UPDATE jobs SET status = 'queued', run_after = now() + make_interval(secs => $3), error = $2 WHERE id = $1",
        finalAttempt ? [job.id, reason.slice(0, 2000)] : [job.id, reason.slice(0, 2000), 30 * job.attempts],
      );
      if (job.type === "process_recording") {
        await this.db.query("UPDATE recordings SET processing = $2, processing_error = $3 WHERE id = $1", [
          rec.id,
          finalAttempt ? "failed" : "queued",
          finalAttempt ? "Processing failed. Try again, or check the server logs." : null,
        ]);
        // A track that finished during this run may be what it needed.
        if (finalAttempt) await this.rerunIfRequested(rec.id);
      } else {
        await this.db.query("UPDATE recordings SET transcript = $2 WHERE id = $1", [rec.id, finalAttempt ? "failed" : "queued"]);
      }
    } finally {
      clearInterval(renew);
      await this.db.query("UPDATE recordings SET progress = NULL WHERE id = $1", [rec.id]).catch(() => {});
      await rm(work, { recursive: true, force: true });
      this.opts.onChange?.(rec.session_id);
    }
  }

  /**
   * Remove a deleted recording's files: its chunks (by track prefix, so objects that were
   * uploaded but never committed go too) and its outputs. A guest's PUT signed just before
   * the delete can still land afterwards, so the job comes back once more after those URLs
   * have expired, and only then is done.
   */
  private async purge(job: JobRow) {
    try {
      const [rec] = await this.db.query<{ session_id: string; due: boolean }>(
        `SELECT r.session_id, now() < j.created_at + make_interval(secs => $2) AS due
         FROM recordings r JOIN jobs j ON j.id = $3 WHERE r.id = $1`,
        [job.recording_id, this.purgeRepeatMs() / 1000, job.id],
      );
      if (rec) {
        const tracks = await this.db.query<{ id: string }>("SELECT id FROM tracks WHERE recording_id = $1", [job.recording_id]);
        let removed = await this.storage.deletePrefix(`outputs/${rec.session_id}/${job.recording_id}/`);
        for (const t of tracks) removed += await this.storage.deletePrefix(`recordings/${rec.session_id}/${t.id}/`);
        console.log(`[worker] purged ${removed} object(s) of deleted recording ${job.recording_id}`);
      }
      if (rec?.due) {
        await this.db.query(
          `UPDATE jobs SET status = 'queued', attempts = 0, locked_until = NULL,
                  run_after = created_at + make_interval(secs => $2) WHERE id = $1`,
          [job.id, this.purgeRepeatMs() / 1000],
        );
      } else {
        await this.db.query("UPDATE jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = $1", [job.id]);
      }
    } catch (err) {
      console.error(`[worker] purge ${job.id} attempt ${job.attempts} failed:`, String(err));
      // Keeps trying (storage may be down for a while); never leave files of a deleted recording behind.
      await this.db.query(
        "UPDATE jobs SET status = 'queued', run_after = now() + make_interval(secs => $3), error = $2 WHERE id = $1",
        [job.id, String(err).slice(0, 2000), Math.min(3600, 30 * job.attempts)],
      );
    }
  }

  /**
   * RAW_RETENTION_DAYS after a recording is processed: delete its original uploads, keep the
   * processed files. Only when nothing can still need them: processing done and successful,
   * every track complete, no processing queued. Otherwise it waits (processing under way) or
   * gives up (it failed, or a track is still arriving); the next successful run schedules it again.
   */
  private async purgeRaw(job: JobRow) {
    const done = (error: string | null = null) =>
      this.db.query("UPDATE jobs SET status = 'done', finished_at = now(), error = $2 WHERE id = $1", [job.id, error]);
    try {
      const [rec] = await this.db.query<{ session_id: string; processing: string; deleted_at: Date | null; raw_deleted_at: Date | null; skipped_tracks: unknown[]; open_tracks: number; busy: boolean }>(
        `SELECT r.session_id, r.processing, r.deleted_at, r.raw_deleted_at, r.skipped_tracks,
                (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id AND t.kind <> 'mask' AND t.status = 'recording') AS open_tracks,
                EXISTS (SELECT 1 FROM jobs j WHERE j.recording_id = r.id AND j.type = 'process_recording' AND j.status IN ('queued', 'running')) AS busy
         FROM recordings r WHERE r.id = $1`,
        [job.recording_id],
      );
      if (!rec || rec.deleted_at || rec.raw_deleted_at) return void (await done());
      if (rec.busy || rec.processing === "queued" || rec.processing === "processing") {
        await this.db.query("UPDATE jobs SET status = 'queued', attempts = 0, locked_until = NULL, run_after = now() + interval '1 hour' WHERE id = $1", [job.id]);
        return;
      }
      if (rec.processing !== "ready" || rec.open_tracks > 0) return void (await done("kept: not fully processed"));
      // A track the files lack exists only in its upload.
      if (rec.skipped_tracks.length > 0) return void (await done("kept: some tracks couldn't be read"));

      // Mark first, so uploads and re-processing are refused while the files go.
      await this.db.query("UPDATE recordings SET raw_deleted_at = now() WHERE id = $1", [job.recording_id]);
      const tracks = await this.db.query<{ id: string }>("SELECT id FROM tracks WHERE recording_id = $1", [job.recording_id]);
      let removed = 0;
      for (const t of tracks) removed += await this.storage.deletePrefix(`recordings/${rec.session_id}/${t.id}/`);
      await this.db.query("DELETE FROM chunks WHERE track_id IN (SELECT id FROM tracks WHERE recording_id = $1)", [job.recording_id]);
      await done();
      console.log(`[worker] removed ${removed} original upload object(s) of ${job.recording_id} (retention)`);
      this.opts.onChange?.(rec.session_id);
    } catch (err) {
      console.error(`[worker] purge_raw ${job.id} attempt ${job.attempts} failed:`, String(err));
      await this.db.query(
        "UPDATE jobs SET status = 'queued', run_after = now() + make_interval(secs => $3), error = $2 WHERE id = $1",
        [job.id, String(err).slice(0, 2000), Math.min(3600, 30 * job.attempts)],
      );
    }
  }

  private purgeRepeatMs() {
    return this.opts.purgeRepeatMs ?? (UPLOAD_URL_TTL_S + 60) * 1000;
  }

  private lockSeconds() {
    return Math.max(1, Math.round((this.opts.lockMs ?? 10 * 60 * 1000) / 1000));
  }

  private async processRecording(rec: RecordingRow, work: string, job: JobRow) {
    const { outputs, skipped, filtersFailed } = await this.render(rec, work);
    const { replaced, rerun } = await this.db.transaction(async (tx) => {
      // Locked first, so a track finishing right now either asks for a rerun before we read it or finds the job done.
      const [row] = await tx.query<{ rerun_requested: boolean }>("SELECT rerun_requested FROM recordings WHERE id = $1 FOR UPDATE", [rec.id]);
      const rerun = row?.rerun_requested ?? false;
      // Re-processing (a late upload, "Process now" twice) replaces the previous files,
      // transcripts included: they are redone from the new audio.
      // Clips were cut from the old combined file: they go with it.
      await tx.query("DELETE FROM clips WHERE recording_id = $1", [rec.id]);
      const old = await tx.query<{ storage_key: string }>("DELETE FROM outputs WHERE recording_id = $1 RETURNING storage_key", [
        rec.id,
      ]);
      for (const o of outputs) await insertOutput(tx, rec.id, o);
      await tx.query(
        // The old notes went with the old files; new ones follow the new transcript.
        `UPDATE recordings SET processing = $2, processed_at = now(), processing_error = NULL, skipped_tracks = $3, filters_failed = $4, rerun_requested = false, notes = 'off', notes_error = NULL WHERE id = $1`,
        [rec.id, rerun ? "queued" : "ready", JSON.stringify(skipped), JSON.stringify(filtersFailed)],
      );
      await tx.query("UPDATE jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = $1", [job.id]);
      if (rerun) {
        await tx.query(`INSERT INTO jobs (id, type, recording_id) VALUES ($1, 'process_recording', $2)`, [newId("job"), rec.id]);
      } else if (this.opts.whisper) {
        // Queued in the same transaction: a recording can't end up processed without its transcript job.
        await tx.query(
          `INSERT INTO jobs (id, type, recording_id) VALUES ($1, 'transcribe_recording', $2)
           ON CONFLICT (recording_id, type) WHERE status IN ('queued', 'running') DO NOTHING`,
          [newId("job"), rec.id],
        );
        await tx.query("UPDATE recordings SET transcript = 'queued' WHERE id = $1", [rec.id]);
      } else {
        await tx.query("UPDATE recordings SET transcript = 'off' WHERE id = $1", [rec.id]);
      }
      let rawRetentionMs = this.opts.rawRetentionMs;
      if (this.opts.cloud) {
        // The host's plan says how long each is kept. Counted from the first time the files were
        // ready: processing again doesn't buy more time.
        rawRetentionMs = await planRetention(tx, rec.id, Date.now());
      }
      // The studio's own rule: deleted this many days after the files are ready. It can only
      // bring the date forward, never past what a plan allows, and processing again doesn't move it later.
      const deleteAfterDays = studioSettings.parse(rec.settings).deleteAfterDays;
      if (deleteAfterDays && !rerun) {
        await tx.query(
          "UPDATE recordings SET keep_until = LEAST(coalesce(keep_until, 'infinity'::timestamptz), now() + make_interval(days => $2)) WHERE id = $1",
          [rec.id, deleteAfterDays],
        );
      }
      if (rawRetentionMs !== undefined) {
        // The originals go once the retention period is over (see purgeRaw).
        await tx.query(
          `INSERT INTO jobs (id, type, recording_id, run_after) VALUES ($1, 'purge_raw', $2, now() + make_interval(secs => $3))
           ON CONFLICT (recording_id, type) WHERE status IN ('queued', 'running')
           DO UPDATE SET run_after = EXCLUDED.run_after WHERE jobs.status = 'queued'`,
          [newId("job"), rec.id, rawRetentionMs / 1000],
        );
      }
      return { replaced: old.map((o) => o.storage_key), rerun };
    });
    await this.removeReplaced(replaced);
    if (rerun) this.kicked = true;
    else if (this.opts.whisper) this.kicked = true; // pick the transcript up right after
  }

  /** Transcribe each person's audio separately (each track is one speaker), then merge by time. */
  private async transcribeRecording(rec: RecordingRow, work: string, job: JobRow) {
    if (!this.opts.whisper) throw new Error("Transcription is not configured on this worker");
    const processedAt = async (q: Queryable, lock = "") =>
      (await q.query<{ at: string | null }>(`SELECT processed_at::text AS at FROM recordings WHERE id = $1 ${lock}`, [rec.id]))[0]?.at ?? null;
    const audioFrom = await processedAt(this.db);
    const audio = (
      await this.db.query<{ storage_key: string; file_name: string }>(
        `SELECT o.storage_key, o.file_name FROM outputs o LEFT JOIN participants p ON p.id = o.participant_id
         WHERE o.recording_id = $1 AND o.kind = 'audio' ORDER BY p.created_at`,
        [rec.id],
      )
    ).filter((a) => !ORIGINAL_AUDIO.test(a.file_name));
    const speakers: SpeakerTranscript[] = [];
    for (const [i, a] of audio.entries()) {
      const speaker = a.file_name.replace(AUDIO_SUFFIX, "");
      await this.progress(rec, { stage: "transcribing", done: i, total: audio.length, current: speaker });
      const path = join(work, `speaker-${i}.${a.file_name.split(".").pop()}`);
      await this.storage.downloadTo(a.storage_key, path);
      const { language, segments } = await transcribeAudio(path, { ...this.opts.whisper, ffmpeg: this.opts.ffmpeg });
      // The file name already holds the unique display name ("Sam (2) - audio.wav").
      speakers.push({ speaker, language, segments });
    }
    const lines = mergeSpeakers(speakers);
    const [studio] = await this.db.query<{ name: string; number: number | null }>(
      "SELECT st.name, r.number FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id WHERE r.id = $1",
      [rec.id],
    );
    const recorded = new Date(rec.started_at).toISOString().slice(0, 10);
    const files: Array<{ name: string; type: string; body: string | Uint8Array }> = [
      { name: "Transcript.txt", type: "text/plain; charset=utf-8", body: toTxt(lines) },
      {
        name: "Transcript.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        body: toDocx(lines, {
          title: `Transcript: ${studio?.name ?? "Recording"}${studio?.number ? `, Recording ${studio.number}` : ""}`,
          subtitle: `Recorded ${recorded} · ${speakers.map((s) => s.speaker).join(", ")}`,
        }),
      },
      { name: "Transcript.srt", type: "application/x-subrip; charset=utf-8", body: toSrt(lines) },
      { name: "Transcript.vtt", type: "text/vtt; charset=utf-8", body: toVtt(lines) },
    ];
    const uploaded: Array<Parameters<typeof insertOutput>[2]> = [];
    for (const f of files) {
      const path = join(work, f.name);
      await writeFile(path, f.body);
      const id = newId("out");
      const key = `outputs/${rec.session_id}/${rec.id}/${id}.${f.name.split(".").pop()}`;
      const bytes = await this.storage.uploadFrom(key, path, f.type);
      uploaded.push({ id, key, bytes, kind: "transcript" as const, fileName: f.name, contentType: f.type, durationMs: null });
    }
    const replaced = await this.db.transaction(async (tx) => {
      // The files were redone while this ran: this transcript is of the old audio, so go again.
      const stale = (await processedAt(tx, "FOR UPDATE")) !== audioFrom;
      const old = await tx.query<{ storage_key: string }>(
        "DELETE FROM outputs WHERE recording_id = $1 AND kind = 'transcript' RETURNING storage_key",
        [rec.id],
      );
      for (const o of uploaded) await insertOutput(tx, rec.id, o);
      await tx.query("UPDATE recordings SET transcript = 'ready', transcribed_at = now() WHERE id = $1", [rec.id]);
      await tx.query("UPDATE jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = $1", [job.id]);
      if (stale) {
        await tx.query(`INSERT INTO jobs (id, type, recording_id) VALUES ($1, 'transcribe_recording', $2)`, [newId("job"), rec.id]);
        await tx.query("UPDATE recordings SET transcript = 'queued' WHERE id = $1", [rec.id]);
        this.kicked = true;
      } else if (this.hasNotesModel()) {
        // Notes are written from this transcript. Whether this account gets them (a local model,
        // or an outside one its owner allowed) is decided when the job runs.
        await queueNotes(tx, rec.id);
        this.kicked = true;
      }
      return old.map((o) => o.storage_key);
    });
    await this.removeReplaced(replaced);
  }

  /** Cut every waiting clip of a recording out of its combined file (or its mix, without video). */
  private async cutClips(job: JobRow) {
    const [rec] = await this.db.query<{ id: string; session_id: string }>("SELECT id, session_id FROM recordings WHERE id = $1 AND deleted_at IS NULL", [job.recording_id]);
    const clips = rec
      ? await this.db.query<{ id: string; start_ms: number; end_ms: number; title: string }>("SELECT id, start_ms, end_ms, title FROM clips WHERE recording_id = $1 AND status = 'queued' ORDER BY created_at", [rec.id])
      : [];
    const [source] = rec ? await this.db.query<{ storage_key: string; file_name: string }>("SELECT storage_key, file_name FROM outputs WHERE recording_id = $1 AND kind = 'combined' LIMIT 1", [rec.id]) : [];
    if (!rec || clips.length === 0 || !source) {
      if (rec && !source) await this.db.query("UPDATE clips SET status = 'failed' WHERE recording_id = $1 AND status = 'queued'", [rec.id]);
      await this.db.query("UPDATE jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = $1", [job.id]);
      return;
    }
    const work = await mkdtemp(join(tmpdir(), "tapry-clips-"));
    const srcExt = source.file_name.split(".").pop()!.toLowerCase();
    const kind = srcExt === "mp4" ? ("video" as const) : srcExt === "flac" ? ("flac" as const) : ("wav" as const);
    const ext = kind === "video" ? "mp4" : kind;
    const type = kind === "video" ? "video/mp4" : kind === "flac" ? "audio/flac" : "audio/wav";
    try {
      const src = join(work, `source.${srcExt}`);
      await this.storage.downloadTo(source.storage_key, src);
      for (const clip of clips) {
        const out = join(work, `${clip.id}.${ext}`);
        try {
          await runFfmpeg(this.opts.ffmpeg, clipArgs(src, out, Number(clip.start_ms), Number(clip.end_ms), kind), { timeoutMs: 10 * 60 * 1000 });
          const id = newId("out");
          const key = `outputs/${rec.session_id}/${rec.id}/${id}.${ext}`;
          const bytes = await this.storage.uploadFrom(key, out, type);
          const kept = await this.db.transaction(async (tx) => {
            // Deleted while it was being cut: the file isn't wanted.
            const [still] = await tx.query("SELECT 1 FROM clips WHERE id = $1 FOR UPDATE", [clip.id]);
            if (!still) return false;
            await insertOutput(tx, rec.id, { id, key, bytes, kind: "clip", fileName: clipFileName({ startMs: Number(clip.start_ms), endMs: Number(clip.end_ms), title: clip.title }, ext), contentType: type, durationMs: Number(clip.end_ms) - Number(clip.start_ms) });
            await tx.query("UPDATE clips SET status = 'ready', output_id = $2 WHERE id = $1", [clip.id, id]);
            return true;
          });
          if (!kept) await this.removeReplaced([key]);
        } catch (err) {
          if (!(err instanceof FfmpegError)) throw err;
          console.error(`[worker] clip ${clip.id} of ${rec.id} failed: ${err.message}`);
          await this.db.query("UPDATE clips SET status = 'failed' WHERE id = $1", [clip.id]);
        }
      }
      await this.db.query("UPDATE jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = $1", [job.id]);
    } catch (err) {
      const again = job.attempts < (this.opts.maxAttempts ?? 3);
      console.error(`[worker] clip_recording ${job.id} attempt ${job.attempts} failed:`, String(err).slice(0, 300));
      await this.db.query(
        again ? "UPDATE jobs SET status = 'queued', run_after = now() + make_interval(secs => $2), error = $3 WHERE id = $1" : "UPDATE jobs SET status = 'failed', finished_at = now(), error = $3 WHERE id = $1 AND $2 > 0",
        [job.id, 30 * job.attempts, String(err).slice(0, 500)],
      );
      if (!again) await this.db.query("UPDATE clips SET status = 'failed' WHERE recording_id = $1 AND status = 'queued'", [rec.id]);
    } finally {
      await rm(work, { recursive: true, force: true });
      this.opts.onChange?.(rec.session_id);
    }
  }

  private models: { local: NotesModel | null; outside: NotesModel | null } | undefined;
  private notesModels() {
    return (this.models ??= this.opts.notesModels ?? notesModels(this.opts.notes));
  }
  private hasNotesModel() {
    const m = this.notesModels();
    return !!(m.local || m.outside);
  }

  /**
   * AI notes from a finished transcript: read Transcript.txt, have the model the account may use
   * write the notes, and save them as "Notes.md". No model for this account: nothing is written
   * and nothing is sent anywhere. The transcript's text never reaches a log.
   */
  private async writeNotes(job: JobRow) {
    const finish = (status: "done" | "failed", error: string | null = null) =>
      this.db.query("UPDATE jobs SET status = $2, finished_at = now(), error = $3 WHERE id = $1", [job.id, status, error]);
    const [rec] = await this.db.query<{ id: string; session_id: string; transcript: string; transcribed_at: string | null; number: number | null; studio: string }>(
      `SELECT r.id, r.session_id, r.transcript, r.transcribed_at::text AS transcribed_at, r.number, st.name AS studio
       FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [job.recording_id],
    );
    const [source] = rec
      ? await this.db.query<{ storage_key: string; bytes: string }>(
          "SELECT storage_key, bytes FROM outputs WHERE recording_id = $1 AND kind = 'transcript' AND file_name = 'Transcript.txt'",
          [rec.id],
        )
      : [];
    const model = rec && rec.transcript === "ready" && source ? await notesModelFor(this.db, rec.id, this.notesModels(), { cloud: !!this.opts.cloud, now: Date.now() }) : null;
    if (!rec || !model || !source) {
      if (rec) await this.db.query("UPDATE recordings SET notes = 'off', notes_error = NULL WHERE id = $1 AND notes IN ('queued', 'processing')", [rec.id]);
      await finish("done");
      if (rec) this.opts.onChange?.(rec.session_id);
      return;
    }
    await this.db.query("UPDATE recordings SET notes = 'processing', notes_error = NULL WHERE id = $1", [rec.id]);
    this.opts.onChange?.(rec.session_id);
    const work = await mkdtemp(join(tmpdir(), "tapry-notes-"));
    const started = Date.now();
    try {
      // Checked by size before reading: a transcript too long for the model is never loaded.
      if (Number(source.bytes) > NOTES_MAX_CHARS * 4) throw new NotesError("too_long", false);
      const transcriptPath = join(work, "transcript.txt");
      await this.storage.downloadTo(source.storage_key, transcriptPath);
      const written = await model.generate({
        title: `${rec.studio}${rec.number ? `, Recording ${rec.number}` : ""}`,
        transcript: await readFile(transcriptPath, "utf8"),
      });
      const footer = `\n---\n\nA draft written by ${model.where === "local" ? "an AI model on this server" : "an outside AI model"} (${model.name}) from the transcript, which is machine-made too. Check names, quotes and times against the recording before you publish.\n`;
      const path = join(work, NOTES_FILE);
      await writeFile(path, written + footer);
      const id = newId("out");
      const key = `outputs/${rec.session_id}/${rec.id}/${id}.md`;
      const type = "text/markdown; charset=utf-8";
      const bytes = await this.storage.uploadFrom(key, path, type);
      const replaced = await this.db.transaction(async (tx) => {
        const [now] = await tx.query<{ transcript: string; transcribed_at: string | null; deleted: boolean }>(
          "SELECT transcript, transcribed_at::text AS transcribed_at, deleted_at IS NOT NULL AS deleted FROM recordings WHERE id = $1 FOR UPDATE",
          [rec.id],
        );
        // Deleted, or its transcript was redone meanwhile: these notes are of something that is gone.
        if (!now || now.deleted || now.transcript !== "ready" || now.transcribed_at !== rec.transcribed_at) {
          await tx.query("UPDATE jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = $1", [job.id]);
          return [key];
        }
        const old = await tx.query<{ storage_key: string }>("DELETE FROM outputs WHERE recording_id = $1 AND kind = 'notes' RETURNING storage_key", [rec.id]);
        await insertOutput(tx, rec.id, { id, key, bytes, kind: "notes", fileName: NOTES_FILE, contentType: type, durationMs: null });
        await tx.query("UPDATE recordings SET notes = 'ready', notes_error = NULL WHERE id = $1", [rec.id]);
        await tx.query("UPDATE jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = $1", [job.id]);
        return old.map((o) => o.storage_key);
      });
      await this.removeReplaced(replaced);
      console.log(`[worker] notes_recording ${job.id} for ${rec.id} done in ${((Date.now() - started) / 1000).toFixed(1)} s (${model.where} model)`);
    } catch (err) {
      // The reason by code only: an error's message could quote the transcript.
      const problem = err instanceof NotesError ? err : new NotesError("failed", true, err instanceof Error ? err.name : "unknown");
      const again = problem.retry && job.attempts < (this.opts.maxAttempts ?? 3);
      console.error(`[worker] notes_recording ${job.id} attempt ${job.attempts} failed: ${problem.message}`);
      if (again) {
        await this.db.query("UPDATE jobs SET status = 'queued', run_after = now() + make_interval(secs => $3), error = $2 WHERE id = $1", [job.id, problem.message, 60 * job.attempts]);
        await this.db.query("UPDATE recordings SET notes = 'queued' WHERE id = $1", [rec.id]);
      } else {
        await finish("failed", problem.message);
        await this.db.query("UPDATE recordings SET notes = 'failed', notes_error = $2 WHERE id = $1", [rec.id, NOTES_ERROR_TEXT[problem.code]]);
      }
    } finally {
      await rm(work, { recursive: true, force: true });
      this.opts.onChange?.(rec.session_id);
    }
  }

  /** What the job is doing now, for the host's timeline. Best effort: progress never fails a job. */
  private async progress(rec: RecordingRow, p: RecordingProgress) {
    await this.db
      .query("UPDATE recordings SET progress = $2 WHERE id = $1", [rec.id, JSON.stringify(p)])
      .catch((err) => console.error("[worker] could not save progress:", String(err)));
    this.opts.onChange?.(rec.session_id);
  }

  /** Files of an earlier run, no longer listed anywhere. Best effort: the job itself succeeded. */
  private async removeReplaced(keys: string[]) {
    if (keys.length === 0) return;
    await this.storage.delete(keys).catch((err) => console.error("[worker] could not remove replaced files:", String(err)));
  }

  private async render(rec: RecordingRow, work: string) {
    const tracks = await this.db.query<{ id: string; participant_id: string; display_name: string; kind: "audio" | "video" | "screen"; started_at: number; filters: unknown }>(
      `SELECT t.id, t.participant_id, p.display_name, t.kind, t.started_at,
              CASE WHEN r.apply_filters THEN t.filters END AS filters
       FROM tracks t JOIN recordings r ON r.id = t.recording_id JOIN participants p ON p.id = t.participant_id
       WHERE t.recording_id = $1 AND t.kind <> 'mask' AND EXISTS (SELECT 1 FROM chunks c WHERE c.track_id = t.id)
       ORDER BY p.created_at, t.kind`,
      [rec.id],
    );
    // Masks (background blur): only whole ones are any use. One still uploading, cut short or
    // missing a chunk is left out, and the pipeline then makes that video without the blur and says so.
    const masks = await this.db.query<{ id: string; participant_id: string; started_at: number }>(
      `SELECT t.id, t.participant_id, t.started_at FROM tracks t
       WHERE t.recording_id = $1 AND t.kind = 'mask' AND t.status = 'complete' AND coalesce(cardinality(t.missing_seqs), 0) = 0
         AND EXISTS (SELECT 1 FROM chunks c WHERE c.track_id = t.id)`,
      [rec.id],
    );
    if (tracks.length === 0) throw new Error("No uploaded media for this recording");

    const inputs: TrackInput[] = [];
    let lastEnd = rec.started_at;
    /** A track's chunks from storage, joined in order. */
    const collect = async (trackId: string) => {
      const chunks = await this.db.query<{ seq: number; storage_key: string; end_ts: number }>(
        "SELECT seq, storage_key, end_ts FROM chunks WHERE track_id = $1 ORDER BY seq",
        [trackId],
      );
      const dir = join(work, trackId);
      await mkdir(dir);
      const paths: string[] = [];
      for (const c of chunks) {
        const path = join(dir, `${String(c.seq).padStart(8, "0")}.chunk`);
        await this.storage.downloadTo(c.storage_key, path);
        paths.push(path);
      }
      const rawPath = join(work, `${trackId}.raw`);
      await concatChunks(paths, rawPath);
      await rm(dir, { recursive: true, force: true });
      return {
        rawPath,
        hasGaps: chunks.some((c, n) => n > 0 && c.seq !== chunks[n - 1]!.seq + 1),
        endTs: chunks.reduce((end, c) => Math.max(end, c.end_ts), 0),
      };
    };
    const collectedMasks = new Map<string, MaskInput | null>();
    /**
     * The mask recorded with a camera track: the person's mask that started nearest to it (a
     * device starts the two together; someone who rejoined has one for each piece). Whether it
     * really covers the video is the pipeline's to judge. A mask that can't be fetched is no mask.
     */
    const maskFor = async (t: { participant_id: string; started_at: number }): Promise<MaskInput | undefined> => {
      const mine = masks.filter((m) => m.participant_id === t.participant_id);
      const mask = mine.sort((a, b) => Math.abs(a.started_at - t.started_at) - Math.abs(b.started_at - t.started_at))[0];
      if (!mask) return undefined;
      if (!collectedMasks.has(mask.id)) {
        try {
          const { rawPath, hasGaps } = await collect(mask.id);
          collectedMasks.set(mask.id, hasGaps ? null : { rawPath, offsetMs: mask.started_at - rec.started_at });
        } catch (err) {
          console.error(`[worker] could not fetch a mask of ${rec.id}:`, String(err).slice(0, 300));
          collectedMasks.set(mask.id, null);
        }
      }
      return collectedMasks.get(mask.id) ?? undefined;
    };
    for (const [i, t] of tracks.entries()) {
      await this.progress(rec, { stage: "collecting", done: i, total: tracks.length, current: t.display_name });
      const { rawPath, hasGaps, endTs } = await collect(t.id);
      lastEnd = Math.max(lastEnd, endTs);
      // A shared screen is kept as it was: a person's look is for their camera.
      const { filters } = t.kind === "screen" ? {} : filtersFor(t.filters);
      const mask = t.kind === "video" && filters?.background === "blur" ? await maskFor(t) : undefined;
      inputs.push({
        trackId: t.id,
        participantId: t.participant_id,
        participantName: t.display_name,
        kind: t.kind,
        rawPath,
        offsetMs: t.started_at - rec.started_at,
        hasGaps,
        endOffsetMs: endTs - rec.started_at,
        ...(filters && { filters }),
        ...(mask && { mask }),
      });
    }

    const settings = studioSettings.parse(rec.settings);
    const skipped: Array<{ name: string; kind: "audio" | "video" | "screen" }> = [];
    const filtersFailed: Array<{ name: string; kind: "audio" | "video" }> = [];
    const files = await renderRecording(inputs, {
      // Metadata in the log, never the name. One bad upload must not cost everyone their files.
      onSkipped: (s: SkippedTrack) => {
        console.error(`[worker] left ${s.kind} ${s.trackId ?? ""} out of ${rec.id}: ${s.reason.slice(0, 500)}`);
        if (s.kind !== "combined" && s.participantName) skipped.push({ name: s.participantName, kind: s.kind });
      },
      // The file is there, as recorded: the host is told whose, the log only what kind.
      onFilterFailed: (f: FilterFailure) => filtersFailed.push({ name: f.name, kind: f.kind }),
      ffmpeg: this.opts.ffmpeg,
      ffprobe: this.opts.ffprobe,
      workDir: join(work, "out"),
      durationMs: Math.max(1000, (rec.stopped_at ?? lastEnd) - rec.started_at),
      videoQuality: settings.videoQuality,
      frameRate: settings.frameRate,
      font: this.opts.font,
      loudness: settings.levelLoudness ? PODCAST_LOUDNESS : null,
      audioFormat: settings.audioFormat,
      onProgress: (p) => void this.progress(rec, { stage: "rendering", ...p }),
    });

    const uploaded = [];
    for (const [i, f] of files.entries()) {
      await this.progress(rec, { stage: "saving", done: i, total: files.length, current: null });
      const id = newId("out");
      const ext = f.path.split(".").pop();
      const key = `outputs/${rec.session_id}/${rec.id}/${id}.${ext}`;
      const bytes = await this.storage.uploadFrom(key, f.path, f.contentType);
      uploaded.push({ ...f, id, key, bytes });
    }
    for (const kind of ["audio", "video"] as const) {
      const count = filtersFailed.filter((f) => f.kind === kind).length;
      if (count) console.error(`[worker] filters couldn't be applied in ${rec.id}: ${count} ${kind} file(s) left as recorded`);
    }
    return { outputs: uploaded, skipped, filtersFailed };
  }
}

/** A track's stored filters for the pipeline; nothing when there are none, or they can't be read (then: as recorded). */
function filtersFor(stored: unknown): { filters?: TrackFilters } {
  if (stored === null || stored === undefined) return {};
  const parsed = trackFilters.safeParse(typeof stored === "string" ? JSON.parse(stored) : stored);
  return parsed.success ? { filters: parsed.data } : {};
}

async function insertOutput(
  tx: Queryable,
  recordingId: string,
  o: { id: string; participantId?: string; trackId?: string; kind: string; fileName: string; contentType: string; key: string; bytes: number; durationMs: number | null },
) {
  await tx.query(
    `INSERT INTO outputs (id, recording_id, participant_id, track_id, kind, file_name, content_type, storage_key, bytes, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [o.id, recordingId, o.participantId ?? null, o.trackId ?? null, o.kind, o.fileName, o.contentType, o.key, o.bytes, o.durationMs],
  );
}
