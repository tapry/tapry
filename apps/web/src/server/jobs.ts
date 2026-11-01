import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { studioSettings } from "@tapry/shared";
import {
  concatChunks,
  FfmpegError,
  mergeSpeakers,
  PODCAST_LOUDNESS,
  renderRecording,
  toSrt,
  toTxt,
  toVtt,
  transcribeAudio,
  type SpeakerTranscript,
  type TrackInput,
  type WhisperOptions,
} from "@tapry/worker";
import type { Db, Queryable } from "./db";
import { newId } from "./ids";
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
  /** Delete an episode's original uploads this long after it's processed. Unset: keep them. */
  rawRetentionMs?: number;
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
}

type JobType = "process_recording" | "transcribe_recording" | "purge_recording" | "purge_raw";
type MediaJobType = Exclude<JobType, "purge_recording" | "purge_raw">;

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

  constructor(
    private db: Db,
    private storage: Storage,
    private opts: JobRunnerOptions,
  ) {}

  start() {
    this.stopped = false;
    this.schedule(0);
  }

  /** Stop taking new jobs. A job already running finishes. */
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
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
    if (job.type !== "purge_recording" && job.type !== "purge_raw") {
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
      } while (this.kicked && !this.stopped);
    } finally {
      this.busy = false;
    }
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
    await this.db.query(`UPDATE recordings SET ${column} = 'processing' WHERE id = $1`, [rec.id]);
    this.opts.onChange?.(rec.session_id);

    // Keep the claim alive for as long as the work takes (transcribing a long episode on a
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
      } else {
        await this.db.query("UPDATE recordings SET transcript = $2 WHERE id = $1", [rec.id, finalAttempt ? "failed" : "queued"]);
      }
    } finally {
      clearInterval(renew);
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
   * RAW_RETENTION_DAYS after an episode is processed: delete its original uploads, keep the
   * processed files. Only when nothing can still need them: processing done and successful,
   * every track complete, no processing queued. Otherwise it waits (processing under way) or
   * gives up (it failed, or a track is still arriving); the next successful run schedules it again.
   */
  private async purgeRaw(job: JobRow) {
    const done = (error: string | null = null) =>
      this.db.query("UPDATE jobs SET status = 'done', finished_at = now(), error = $2 WHERE id = $1", [job.id, error]);
    try {
      const [rec] = await this.db.query<{ session_id: string; processing: string; deleted_at: Date | null; raw_deleted_at: Date | null; open_tracks: number; busy: boolean }>(
        `SELECT r.session_id, r.processing, r.deleted_at, r.raw_deleted_at,
                (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id AND t.status = 'recording') AS open_tracks,
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
    const outputs = await this.render(rec, work);
    const replaced = await this.db.transaction(async (tx) => {
      // Re-processing (a late upload, "Process now" twice) replaces the previous files,
      // transcripts included: they are redone from the new audio.
      const old = await tx.query<{ storage_key: string }>("DELETE FROM outputs WHERE recording_id = $1 RETURNING storage_key", [
        rec.id,
      ]);
      for (const o of outputs) await insertOutput(tx, rec.id, o);
      await tx.query(
        "UPDATE recordings SET processing = 'ready', processed_at = now(), processing_error = NULL WHERE id = $1",
        [rec.id],
      );
      await tx.query("UPDATE jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = $1", [job.id]);
      if (this.opts.whisper) {
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
      if (this.opts.rawRetentionMs !== undefined) {
        // The originals go once the retention period is over (see purgeRaw).
        await tx.query(
          `INSERT INTO jobs (id, type, recording_id, run_after) VALUES ($1, 'purge_raw', $2, now() + make_interval(secs => $3))
           ON CONFLICT (recording_id, type) WHERE status IN ('queued', 'running')
           DO UPDATE SET run_after = EXCLUDED.run_after WHERE jobs.status = 'queued'`,
          [newId("job"), rec.id, this.opts.rawRetentionMs / 1000],
        );
      }
      return old.map((o) => o.storage_key);
    });
    await this.removeReplaced(replaced);
    if (this.opts.whisper) this.kicked = true; // pick the transcript up right after
  }

  /** Transcribe each person's WAV separately (each track is one speaker), then merge by time. */
  private async transcribeRecording(rec: RecordingRow, work: string, job: JobRow) {
    if (!this.opts.whisper) throw new Error("Transcription is not configured on this worker");
    const audio = await this.db.query<{ storage_key: string; file_name: string }>(
      `SELECT o.storage_key, o.file_name FROM outputs o LEFT JOIN participants p ON p.id = o.participant_id
       WHERE o.recording_id = $1 AND o.kind = 'audio' ORDER BY p.created_at`,
      [rec.id],
    );
    const speakers: SpeakerTranscript[] = [];
    for (const [i, a] of audio.entries()) {
      const path = join(work, `speaker-${i}.wav`);
      await this.storage.downloadTo(a.storage_key, path);
      const { language, segments } = await transcribeAudio(path, { ...this.opts.whisper, ffmpeg: this.opts.ffmpeg });
      // The file name already holds the unique display name ("Sam (2) - audio.wav").
      speakers.push({ speaker: a.file_name.replace(/ - audio\.wav$/, ""), language, segments });
    }
    const lines = mergeSpeakers(speakers);
    const files = [
      { name: "Transcript.txt", type: "text/plain; charset=utf-8", body: toTxt(lines) },
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
      const old = await tx.query<{ storage_key: string }>(
        "DELETE FROM outputs WHERE recording_id = $1 AND kind = 'transcript' RETURNING storage_key",
        [rec.id],
      );
      for (const o of uploaded) await insertOutput(tx, rec.id, o);
      await tx.query("UPDATE recordings SET transcript = 'ready' WHERE id = $1", [rec.id]);
      await tx.query("UPDATE jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = $1", [job.id]);
      return old.map((o) => o.storage_key);
    });
    await this.removeReplaced(replaced);
  }

  /** Files of an earlier run, no longer listed anywhere. Best effort: the job itself succeeded. */
  private async removeReplaced(keys: string[]) {
    if (keys.length === 0) return;
    await this.storage.delete(keys).catch((err) => console.error("[worker] could not remove replaced files:", String(err)));
  }

  private async render(rec: RecordingRow, work: string) {
    const tracks = await this.db.query<{ id: string; participant_id: string; display_name: string; kind: "audio" | "video"; started_at: number }>(
      `SELECT t.id, t.participant_id, p.display_name, t.kind, t.started_at
       FROM tracks t JOIN participants p ON p.id = t.participant_id
       WHERE t.recording_id = $1 AND EXISTS (SELECT 1 FROM chunks c WHERE c.track_id = t.id)
       ORDER BY p.created_at, t.kind`,
      [rec.id],
    );
    if (tracks.length === 0) throw new Error("No uploaded media for this recording");

    const inputs: TrackInput[] = [];
    let lastEnd = rec.started_at;
    for (const t of tracks) {
      const chunks = await this.db.query<{ seq: number; storage_key: string; end_ts: number }>(
        "SELECT seq, storage_key, end_ts FROM chunks WHERE track_id = $1 ORDER BY seq",
        [t.id],
      );
      const dir = join(work, t.id);
      await mkdir(dir);
      const paths: string[] = [];
      for (const c of chunks) {
        const path = join(dir, `${String(c.seq).padStart(8, "0")}.chunk`);
        await this.storage.downloadTo(c.storage_key, path);
        paths.push(path);
        lastEnd = Math.max(lastEnd, c.end_ts);
      }
      const rawPath = join(work, `${t.id}.raw`);
      await concatChunks(paths, rawPath);
      await rm(dir, { recursive: true, force: true });
      inputs.push({
        trackId: t.id,
        participantId: t.participant_id,
        participantName: t.display_name,
        kind: t.kind,
        rawPath,
        offsetMs: t.started_at - rec.started_at,
      });
    }

    const settings = studioSettings.parse(rec.settings);
    const files = await renderRecording(inputs, {
      ffmpeg: this.opts.ffmpeg,
      ffprobe: this.opts.ffprobe,
      workDir: join(work, "out"),
      durationMs: Math.max(1000, (rec.stopped_at ?? lastEnd) - rec.started_at),
      videoHeight: settings.videoQuality === "720p" ? 720 : 1080,
      font: this.opts.font,
      loudness: settings.levelLoudness ? PODCAST_LOUDNESS : null,
    });

    const uploaded = [];
    for (const f of files) {
      const id = newId("out");
      const ext = f.path.split(".").pop();
      const key = `outputs/${rec.session_id}/${rec.id}/${id}.${ext}`;
      const bytes = await this.storage.uploadFrom(key, f.path, f.contentType);
      uploaded.push({ ...f, id, key, bytes });
    }
    return uploaded;
  }
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
