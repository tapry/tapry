import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { studioSettings } from "@opentake/shared";
import { concatChunks, FfmpegError, renderRecording, type TrackInput } from "@opentake/worker";
import type { Db } from "./db";
import { newId } from "./ids";
import type { Storage } from "./storage";

export interface JobRunnerOptions {
  ffmpeg: string;
  ffprobe: string;
  /** How often to look for work when nothing kicked us. */
  pollMs?: number;
  maxAttempts?: number;
  /** A claimed job is given back if its worker hasn't finished by then (crash, kill). */
  lockMs?: number;
  /** Something changed for this session (status shown to the host). */
  onChange?: (sessionId: string) => void;
}

interface JobRow {
  id: string;
  recording_id: string;
  attempts: number;
}

/**
 * Takes process_recording jobs from Postgres and runs the media pipeline. Several
 * runners (processes, machines) can share one database: claims use SKIP LOCKED.
 */
export class JobRunner {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private stopped = false;
  private kicked = false;

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
        for (let job = await this.claim(); job && !this.stopped; job = await this.claim()) await this.process(job);
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
      } catch (err) {
        console.error("[worker] poll failed", err);
      }
      this.schedule(this.opts.pollMs ?? 5000);
    }, ms);
  }

  private async claim(): Promise<JobRow | null> {
    const lockSeconds = Math.round((this.opts.lockMs ?? 60 * 60 * 1000) / 1000);
    return this.db.transaction(async (tx) => {
      const [job] = await tx.query<JobRow>(
        `SELECT id, recording_id, attempts FROM jobs
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
    const [rec] = await this.db.query<{
      id: string;
      session_id: string;
      started_at: number;
      stopped_at: number | null;
      settings: unknown;
    }>(
      `SELECT r.id, r.session_id, r.started_at, r.stopped_at, st.settings
       FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.id = $1`,
      [job.recording_id],
    );
    if (!rec) {
      await this.db.query("UPDATE jobs SET status = 'done', finished_at = now() WHERE id = $1", [job.id]);
      return;
    }
    await this.db.query("UPDATE recordings SET processing = 'processing' WHERE id = $1", [rec.id]);
    this.opts.onChange?.(rec.session_id);

    const work = await mkdtemp(join(tmpdir(), "opentake-job-"));
    try {
      const outputs = await this.render(rec, work);
      await this.db.transaction(async (tx) => {
        // Re-processing (a late upload, "Process now" twice) replaces the previous files.
        await tx.query("DELETE FROM outputs WHERE recording_id = $1", [rec.id]);
        for (const o of outputs) {
          await tx.query(
            `INSERT INTO outputs (id, recording_id, participant_id, track_id, kind, file_name, content_type, storage_key, bytes, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [o.id, rec.id, o.participantId ?? null, o.trackId ?? null, o.kind, o.fileName, o.contentType, o.key, o.bytes, o.durationMs],
          );
        }
        await tx.query(
          "UPDATE recordings SET processing = 'ready', processed_at = now(), processing_error = NULL WHERE id = $1",
          [rec.id],
        );
        await tx.query("UPDATE jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = $1", [job.id]);
      });
    } catch (err) {
      // Logs and the database get the reason only, never media.
      const reason = err instanceof FfmpegError ? `${err.message}: ${err.stderrTail.split("\n").slice(-3).join(" ")}` : String(err);
      console.error(`[worker] job ${job.id} attempt ${job.attempts} failed:`, reason);
      const finalAttempt = job.attempts >= (this.opts.maxAttempts ?? 3);
      await this.db.query(
        finalAttempt
          ? "UPDATE jobs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1"
          : "UPDATE jobs SET status = 'queued', run_after = now() + make_interval(secs => $3), error = $2 WHERE id = $1",
        finalAttempt ? [job.id, reason.slice(0, 2000)] : [job.id, reason.slice(0, 2000), 30 * job.attempts],
      );
      await this.db.query("UPDATE recordings SET processing = $2, processing_error = $3 WHERE id = $1", [
        rec.id,
        finalAttempt ? "failed" : "queued",
        finalAttempt ? "Processing failed. Try again, or check the server logs." : null,
      ]);
    } finally {
      await rm(work, { recursive: true, force: true });
      this.opts.onChange?.(rec.session_id);
    }
  }

  private async render(
    rec: { id: string; session_id: string; started_at: number; stopped_at: number | null; settings: unknown },
    work: string,
  ) {
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
