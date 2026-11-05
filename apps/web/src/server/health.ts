// The admin health page: is everything this install needs working, and if not, what to look
// at. Checks run when the page is opened; nothing here records media or personal data.
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallConfig } from "./call";
import type { Db } from "./db";
import { HEARTBEAT_MS } from "./jobs";
import { mailFailureReason, type Mailer } from "./mail";
import { MIGRATIONS } from "./migrations";
import type { Storage } from "./storage";
import { APP_VERSION, type WorkerInfo } from "./worker-info";

export type Tone = "ok" | "warn" | "danger" | "off";

export interface HealthCheck {
  id: "database" | "storage" | "workers" | "queue" | "transcripts" | "call" | "email" | "disk" | "version";
  label: string;
  tone: Tone;
  summary: string;
  details: string[];
}

export interface HealthReport {
  version: string;
  checkedAt: number;
  checks: HealthCheck[];
  workers: Array<{ id: string; kind: "inprocess" | "worker"; version: string; seenAt: number; startedAt: number; info: WorkerInfo; ageMs: number }>;
  /** LiveKit's address, for the page to test from the browser; null without a call. */
  callUrl: string | null;
  /** Recent failed jobs: the reason only (ffmpeg's last lines), never media. */
  failures: Array<{ type: string; recordingId: string; error: string | null; at: number }>;
}

export interface HealthOptions {
  call?: CallConfig | null;
  mailer?: Mailer | null;
  /** "owner/name" of the GitHub repo to compare the version with; unset: no update check. */
  updateRepo?: string | null;
  /** Web server runs jobs itself (WORKER=inprocess) or leaves them to separate workers. */
  inProcess?: boolean;
  fetch?: typeof fetch;
  /** This server's version (tests pass one). */
  version?: string;
}

/** A runner that missed this many beats is gone. */
const GONE_AFTER_MS = 3 * HEARTBEAT_MS;
const QUEUE_SLOW_MS = 10 * 60_000;
const LOW_DISK_BYTES = 5 * 1024 ** 3;
const UPDATE_CACHE_MS = 6 * 60 * 60_000;

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;
const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} s ago` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min ago` : `${Math.round(ms / 3_600_000)} h ago`);

export class HealthService {
  private latest: { at: number; tag: string | null } | null = null;

  private appVersion: string;

  constructor(
    private db: Db,
    private storage: Storage,
    private opts: HealthOptions = {},
  ) {
    this.appVersion = opts.version ?? APP_VERSION;
  }

  async report(): Promise<HealthReport> {
    const [database, storage, runners, failures, version, email] = await Promise.all([
      this.database(),
      this.storageCheck(),
      this.runners(),
      this.failures(),
      this.version(),
      this.email(),
    ]);
    // Ages come from the database's clock, like the times they're measured from.
    const alive = runners.filter((w) => w.ageMs < GONE_AFTER_MS);
    const queue = await this.queue(alive.length);
    return {
      version: this.appVersion,
      checkedAt: Date.now(),
      checks: [database, storage, this.workersCheck(alive, runners), queue, this.transcripts(alive), this.disk(alive), this.call(), email, version],
      callUrl: this.opts.call?.url ?? null,
      workers: runners,
      failures,
    };
  }

  private async database(): Promise<HealthCheck> {
    const t0 = performance.now();
    try {
      const [v] = await this.db.query<{ version: string }>("SELECT version() AS version");
      const ms = Math.round(performance.now() - t0);
      const [m] = await this.db.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations");
      const engine = v!.version.split(" on ")[0]!.split(",")[0]!;
      const behind = MIGRATIONS.length - m!.n;
      return {
        id: "database",
        label: "Database",
        tone: behind === 0 ? "ok" : "danger",
        summary: behind === 0 ? `Answering in ${ms} ms` : `${behind} database update(s) not applied: restart the app`,
        details: [engine, `${m!.n} of ${MIGRATIONS.length} updates applied`],
      };
    } catch (err) {
      return { id: "database", label: "Database", tone: "danger", summary: "Not answering", details: [String(err).slice(0, 300)] };
    }
  }

  /** Write, read back and delete a small object: the same calls recordings rely on. */
  private async storageCheck(): Promise<HealthCheck> {
    const key = `health/check-${randomBytes(6).toString("hex")}.txt`;
    const dir = await mkdtemp(join(tmpdir(), "tapry-health-"));
    const t0 = performance.now();
    try {
      const path = join(dir, "check.txt");
      await writeFile(path, "tapry health check\n");
      await this.storage.uploadFrom(key, path, "text/plain");
      const found = await this.storage.head(key);
      await this.storage.delete([key]);
      if (!found) throw new Error("The test file wasn't there after writing it");
      return {
        id: "storage",
        label: "Storage",
        tone: "ok",
        summary: `Writes, reads and deletes (${Math.round(performance.now() - t0)} ms)`,
        details: [],
      };
    } catch (err) {
      return {
        id: "storage",
        label: "Storage",
        tone: "danger",
        summary: "Can't write to storage: uploads and downloads will fail",
        details: [String(err).slice(0, 300), "Check S3_ENDPOINT, S3_BUCKET and the access keys, and that the storage service is running."],
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async runners(): Promise<HealthReport["workers"]> {
    const rows = await this.db.query<{ id: string; kind: "inprocess" | "worker"; version: string; info: WorkerInfo; seen_at: Date; started_at: Date; age_ms: number }>(
      `SELECT id, kind, version, info, seen_at, started_at, (extract(epoch FROM now() - seen_at) * 1000)::bigint AS age_ms
       FROM workers ORDER BY started_at`,
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      version: r.version,
      info: r.info,
      seenAt: new Date(r.seen_at).getTime(),
      startedAt: new Date(r.started_at).getTime(),
      ageMs: Number(r.age_ms),
    }));
  }

  private workersCheck(alive: HealthReport["workers"], all: HealthReport["workers"]): HealthCheck {
    const label = "Processing";
    if (alive.length === 0) {
      const last = all.at(-1);
      return {
        id: "workers",
        label,
        tone: "danger",
        summary: "No worker is running: new recordings won't be processed",
        details: [
          last ? `Last seen ${ago(last.ageMs)}.` : "None has started since this version was installed.",
          this.opts.inProcess === false
            ? "This server leaves processing to separate workers (WORKER=off): start the worker service."
            : "Restart the app.",
        ],
      };
    }
    const problems: string[] = [];
    for (const w of alive) {
      const where = w.kind === "inprocess" ? "The web server" : `Worker ${w.id.slice(-6)}`;
      if (!w.info.ffmpeg) problems.push(`${where} can't run ffmpeg (FFMPEG_PATH).`);
      if (!w.info.ffprobe) problems.push(`${where} can't run ffprobe (FFPROBE_PATH).`);
      if (w.version !== this.appVersion) problems.push(`${where} runs version ${w.version}, the web server ${this.appVersion}.`);
    }
    const names = alive.map((w) => (w.kind === "inprocess" ? "inside the web server" : "separate worker")).join(", ");
    return {
      id: "workers",
      label,
      tone: problems.some((p) => p.includes("can't run")) ? "danger" : problems.length ? "warn" : "ok",
      summary: problems.length ? problems[0]! : `${alive.length} worker${alive.length === 1 ? "" : "s"} running (${names})`,
      details: [...problems.slice(1), ...[...new Set(alive.map((w) => w.info.ffmpeg).filter(Boolean))] as string[]],
    };
  }

  private async queue(alive: number): Promise<HealthCheck> {
    const [q] = await this.db.query<{ queued: number; running: number; failed: number; wait_ms: number | null }>(
      `SELECT count(*) FILTER (WHERE status = 'queued' AND run_after <= now())::int AS queued,
              count(*) FILTER (WHERE status = 'running')::int AS running,
              count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '1 day')::int AS failed,
              (extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'queued' AND run_after <= now())) * 1000)::bigint AS wait_ms
       FROM jobs WHERE type IN ('process_recording', 'transcribe_recording')`,
    );
    const waitMs = Number(q!.wait_ms ?? 0);
    const details = [`${q!.running} running, ${q!.queued} waiting, ${q!.failed} failed in the last day`];
    if (q!.failed > 0) {
      return { id: "queue", label: "Job queue", tone: "warn", summary: `${q!.failed} job${q!.failed === 1 ? "" : "s"} failed in the last day (below)`, details };
    }
    if (q!.queued > 0 && waitMs > QUEUE_SLOW_MS) {
      return {
        id: "queue",
        label: "Job queue",
        tone: "warn",
        summary: `The oldest job has waited ${ago(waitMs).replace(" ago", "")}${alive > 0 ? ": workers are busy (add one with WORKER_REPLICAS)" : ""}`,
        details,
      };
    }
    return { id: "queue", label: "Job queue", tone: "ok", summary: q!.queued || q!.running ? "Moving" : "Empty", details };
  }

  private transcripts(alive: HealthReport["workers"]): HealthCheck {
    const configured = alive.filter((w) => w.info.whisper);
    if (configured.length === 0) {
      return { id: "transcripts", label: "Transcripts", tone: "off", summary: "Off (set WHISPER_MODEL to turn them on)", details: [] };
    }
    const missing = configured.filter((w) => !w.info.whisper!.modelFound);
    return missing.length
      ? {
          id: "transcripts",
          label: "Transcripts",
          tone: "danger",
          summary: "The transcript model file is missing: transcripts will fail",
          details: [...new Set(missing.map((w) => w.info.whisper!.model))].map((m) => `Not found: ${m}`),
        }
      : { id: "transcripts", label: "Transcripts", tone: "ok", summary: "On", details: [...new Set(configured.map((w) => w.info.whisper!.model))] };
  }

  private disk(alive: HealthReport["workers"]): HealthCheck {
    const known = alive.filter((w) => w.info.tmpFreeBytes !== null);
    if (known.length === 0) return { id: "disk", label: "Working space", tone: "off", summary: "Unknown", details: [] };
    const least = Math.min(...known.map((w) => w.info.tmpFreeBytes!));
    return {
      id: "disk",
      label: "Working space",
      tone: least < LOW_DISK_BYTES ? "warn" : "ok",
      summary:
        least < LOW_DISK_BYTES
          ? `Only ${gb(least)} free where recordings are processed: long recordings may not fit`
          : `${gb(least)} free where recordings are processed`,
      details: [],
    };
  }

  /**
   * Whether the call is set up. Reaching LiveKit is tested from the admin's browser on the page
   * (the way guests reach it): the server never talks to LiveKit itself, only signs tokens, and
   * from inside a container its public address often doesn't lead back to it.
   */
  private call(): HealthCheck {
    const call = this.opts.call;
    if (!call) return { id: "call", label: "Live call", tone: "off", summary: "Off: recording works without a call (set LIVEKIT_URL)", details: [] };
    return { id: "call", label: "Live call", tone: "ok", summary: "On", details: [call.url] };
  }

  /** The running version, and (only when UPDATE_CHECK_REPO is set) whether a newer one is out. */
  /** Logs in to the mail server, sending nothing. Says how many recaps gave up, never to whom. */
  private async email(): Promise<HealthCheck> {
    const base = { id: "email" as const, label: "Email" };
    const { mailer } = this.opts;
    if (!mailer) return { ...base, tone: "off", summary: "Off: guests aren't offered a recap email (set SMTP_HOST)", details: [] };
    try {
      await mailer.verify();
    } catch (err) {
      return { ...base, tone: "danger", summary: "Can't reach the mail server", details: [mailFailureReason(err), "Check SMTP_HOST, SMTP_PORT and the login. Recording works without it."] };
    }
    const failed = await this.db.query<{ error: string }>(
      "SELECT error FROM recap_requests WHERE status = 'failed' AND error <> 'NO_FILES' AND finished_at > now() - interval '7 days'",
    );
    if (failed.length === 0) return { ...base, tone: "ok", summary: "On", details: [] };
    return {
      ...base,
      tone: "warn",
      summary: `${failed.length} recap email${failed.length === 1 ? "" : "s"} couldn't be sent in the last 7 days`,
      details: [...new Set(failed.map((f) => f.error))],
    };
  }

  private async version(): Promise<HealthCheck> {
    const repo = this.opts.updateRepo;
    const base = { id: "version" as const, label: "Version" };
    if (!repo) return { ...base, tone: "ok", summary: this.appVersion, details: ["Update check off (set UPDATE_CHECK_REPO to compare with the latest release)."] };
    if (!this.latest || Date.now() - this.latest.at > UPDATE_CACHE_MS) {
      let tag: string | null = null;
      try {
        const res = await (this.opts.fetch ?? fetch)(`https://api.github.com/repos/${repo}/releases/latest`, {
          headers: { accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) tag = ((await res.json()) as { tag_name?: string }).tag_name ?? null;
      } catch {
        // Offline: say we couldn't tell.
      }
      this.latest = { at: Date.now(), tag };
    }
    const latest = this.latest.tag?.replace(/^v/, "") ?? null;
    if (!latest) return { ...base, tone: "ok", summary: this.appVersion, details: ["Couldn't check for a newer release just now."] };
    const newer = this.appVersion !== "dev" && compareVersions(latest, this.appVersion) > 0;
    return newer
      ? { ...base, tone: "warn", summary: `${this.appVersion}: version ${latest} is out`, details: [`https://github.com/${repo}/releases/tag/v${latest}`] }
      : { ...base, tone: "ok", summary: `${this.appVersion}, the latest`, details: [] };
  }

  private async failures(): Promise<HealthReport["failures"]> {
    const rows = await this.db.query<{ type: string; recording_id: string; error: string | null; finished_at: Date }>(
      `SELECT type, recording_id, error, finished_at FROM jobs
       WHERE status = 'failed' AND finished_at > now() - interval '7 days' ORDER BY finished_at DESC LIMIT 10`,
    );
    return rows.map((r) => ({ type: r.type, recordingId: r.recording_id, error: r.error, at: new Date(r.finished_at).getTime() }));
  }
}

/** 0.10.1 > 0.9.3: numeric, part by part. */
export function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
