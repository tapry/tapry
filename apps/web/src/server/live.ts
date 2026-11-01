import { STALE_REPORT_MS, type QualityAlert, type SessionState, type TalkTime, type telemetryBody } from "@tapry/shared";
import type { z } from "zod";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { hashToken, newId } from "./ids";

export interface Participant {
  id: string;
  sessionId: string;
  role: "host" | "guest";
}

type Listener = (state: SessionState) => void;

/**
 * Who is subscribed to which session, plus pending throttled publishes. Separate from
 * LiveService so one hub can be shared by every LiveService in the process (see context.ts).
 */
export class LiveHub {
  readonly listeners = new Map<string, Set<Listener>>();
  readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  /** Latest quality report per session and participant. In memory: it only matters live. */
  readonly health = new Map<string, Map<string, SessionState["health"][number]>>();
}

/**
 * Live session state: who is in the room, and whether a recording is running.
 *
 * The database is the source of truth. Every change publishes a full snapshot to
 * subscribers (SSE), and a new subscriber gets the current snapshot first, so a
 * client that reconnects after missing events is immediately correct again.
 *
 * Subscribers live in this process. With several web instances this needs a
 * shared channel (Redis pub/sub or Postgres LISTEN/NOTIFY).
 */
export class LiveService {
  private hub: LiveHub;
  private onStopped: (recordingId: string) => void | Promise<void>;
  private now: () => number;

  constructor(
    private db: Db,
    opts: { now?: () => number; hub?: LiveHub; onStopped?: (recordingId: string) => void | Promise<void> } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.onStopped = opts.onStopped ?? (() => {});
    this.hub = opts.hub ?? new LiveHub();
  }

  serverTime() {
    return this.now();
  }

  /** Resolve a participant bearer token for this session. */
  async authenticate(token: string | undefined, sessionId: string): Promise<Participant> {
    if (!token) throw new ApiError(401, "unauthorized", "Missing bearer token");
    const [row] = await this.db.query<{ id: string; session_id: string; role: Participant["role"] }>(
      "SELECT id, session_id, role FROM participants WHERE token_hash = $1",
      [hashToken(token)],
    );
    if (!row) throw new ApiError(401, "unauthorized", "Unknown token");
    if (row.session_id !== sessionId) throw new ApiError(403, "forbidden", "Token is for a different session");
    return { id: row.id, sessionId: row.session_id, role: row.role };
  }

  async state(sessionId: string): Promise<SessionState> {
    const [session] = await this.db.query<{ id: string; studio_id: string; status: "open" | "ended" }>(
      "SELECT id, studio_id, status FROM sessions WHERE id = $1",
      [sessionId],
    );
    if (!session) throw new ApiError(404, "session_not_found", "Session not found");
    const [recording] = await this.db.query<{
      id: string;
      status: "recording" | "stopped";
      started_at: number;
      stopped_at: number | null;
    }>(
      `SELECT id, status, started_at, stopped_at FROM recordings WHERE session_id = $1 AND deleted_at IS NULL
       ORDER BY (status = 'recording') DESC, started_at DESC LIMIT 1`,
      [sessionId],
    );
    const participants = await this.db.query<{ id: string; display_name: string; role: "host" | "guest" }>(
      "SELECT id, display_name, role FROM participants WHERE session_id = $1 ORDER BY created_at",
      [sessionId],
    );
    const uploads = recording
      ? await this.db.query<{ participant_id: string; tracks: number; complete_tracks: number; bytes: number }>(
          `SELECT t.participant_id,
                  count(DISTINCT t.id)::int AS tracks,
                  count(DISTINCT t.id) FILTER (WHERE t.status <> 'recording')::int AS complete_tracks,
                  coalesce(sum(c.bytes), 0)::bigint AS bytes
           FROM tracks t LEFT JOIN chunks c ON c.track_id = t.id
           WHERE t.recording_id = $1
           GROUP BY t.participant_id`,
          [recording.id],
        )
      : [];
    return {
      session: { id: session.id, studioId: session.studio_id, status: session.status },
      uploads: uploads.map((u) => ({
        participantId: u.participant_id,
        tracks: u.tracks,
        completeTracks: u.complete_tracks,
        bytes: u.bytes,
      })),
      recording: recording
        ? { id: recording.id, status: recording.status, startedAt: recording.started_at, stoppedAt: recording.stopped_at }
        : null,
      participants: participants.map((p) => ({ id: p.id, displayName: p.display_name, role: p.role })),
      health: [...(this.hub.health.get(sessionId)?.values() ?? [])].filter((h) => participants.some((p) => p.id === h.participantId)),
      serverTime: this.now(),
    };
  }

  /** Host presses Record. The server timestamp is the shared reference every track aligns to. */
  async startRecording(host: Participant) {
    requireHost(host);
    await this.requireOpen(host.sessionId);
    const id = newId("rec");
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO recordings (id, session_id, started_at, number)
       SELECT $1, $2, $3, coalesce(max(r.number), 0) + 1
       FROM sessions s LEFT JOIN sessions s2 ON s2.studio_id = s.studio_id LEFT JOIN recordings r ON r.session_id = s2.id
       WHERE s.id = $2
       ON CONFLICT (session_id) WHERE status = 'recording' DO NOTHING RETURNING id`,
      [id, host.sessionId, this.now()],
    );
    if (!row) throw new ApiError(409, "already_recording", "A recording is already running");
    await this.publish(host.sessionId);
    return this.state(host.sessionId);
  }

  /** Host presses Stop. Idempotent: stopping a stopped recording returns the current state. */
  async stopRecording(host: Participant, recordingId: string) {
    requireHost(host);
    const [rec] = await this.db.query("SELECT id FROM recordings WHERE id = $1 AND session_id = $2", [
      recordingId,
      host.sessionId,
    ]);
    if (!rec) throw new ApiError(404, "recording_not_found", "Recording not found");
    await this.db.query(
      "UPDATE recordings SET status = 'stopped', stopped_at = $2 WHERE id = $1 AND status = 'recording'",
      [recordingId, this.now()],
    );
    await this.publish(host.sessionId);
    await this.onStopped(recordingId);
    return this.state(host.sessionId);
  }

  /** Host leaves for good: stops any running recording and closes the room to new guests. */
  async endSession(host: Participant) {
    requireHost(host);
    const stopped = await this.db.transaction(async (tx) => {
      const rows = await tx.query<{ id: string }>(
        "UPDATE recordings SET status = 'stopped', stopped_at = $2 WHERE session_id = $1 AND status = 'recording' RETURNING id",
        [host.sessionId, this.now()],
      );
      await tx.query("UPDATE sessions SET status = 'ended', ended_at = now() WHERE id = $1 AND status = 'open'", [
        host.sessionId,
      ]);
      return rows;
    });
    await this.publish(host.sessionId);
    for (const r of stopped) await this.onStopped(r.id);
    return this.state(host.sessionId);
  }

  /**
   * A device's quality report (metadata only). Kept in memory, and pushed to the session when
   * it changes in a way the host would see; a report that only refreshes it isn't pushed.
   */
  reportHealth(p: Participant, body: z.infer<typeof telemetryBody>) {
    const reports = this.hub.health.get(p.sessionId) ?? new Map();
    this.hub.health.set(p.sessionId, reports);
    const before = reports.get(p.id);
    const alerts = [...new Set(body.alerts)].sort() as QualityAlert[];
    // Lag in whole minutes is what the host sees, so finer changes don't need a push.
    const minutes = (s: number | null) => (s === null ? -1 : Math.floor(s / 60));
    // Talk time moves every report; the host's shares only need it every 5 s.
    const talkKey = (t: TalkTime | null | undefined) => (t ? `${t.recordingId}:${Math.floor(t.ms / 5000)}` : "");
    const talk = body.talk ?? null;
    reports.set(p.id, { participantId: p.id, alerts, uploadBehindS: body.uploadBehindS, talk, reportedAt: this.now() });
    const changed =
      !before ||
      before.alerts.join() !== alerts.join() ||
      minutes(before.uploadBehindS) !== minutes(body.uploadBehindS) ||
      talkKey(before.talk) !== talkKey(talk) ||
      this.now() - before.reportedAt > STALE_REPORT_MS; // was stale: the host should see it's back
    if (changed) this.publishSoon(p.sessionId, 250);
  }

  /** Subscribe to state snapshots. The current state is delivered first. */
  async subscribe(sessionId: string, listener: Listener): Promise<() => void> {
    const set = this.hub.listeners.get(sessionId) ?? new Set();
    this.hub.listeners.set(sessionId, set);
    set.add(listener);
    listener(await this.state(sessionId));
    return () => {
      set.delete(listener);
      if (set.size === 0) this.hub.listeners.delete(sessionId);
    };
  }

  /**
   * Publish at most once per interval per session. Upload progress changes with every
   * chunk from every participant; nobody needs those as separate events.
   */
  publishSoon(sessionId: string, intervalMs = 1000) {
    if (this.hub.pending.has(sessionId) || !this.hub.listeners.get(sessionId)?.size) return;
    this.hub.pending.set(
      sessionId,
      setTimeout(() => {
        this.hub.pending.delete(sessionId);
        this.publish(sessionId).catch((err) => console.error("[live] publish failed", err));
      }, intervalMs),
    );
  }

  /** Push a fresh snapshot to everyone in the session. */
  async publish(sessionId: string) {
    const set = this.hub.listeners.get(sessionId);
    if (!set?.size) return;
    const state = await this.state(sessionId);
    for (const listener of set) {
      try {
        listener(state);
      } catch (err) {
        console.error("[live] listener failed", err);
      }
    }
  }

  private async requireOpen(sessionId: string) {
    const [s] = await this.db.query<{ status: string }>("SELECT status FROM sessions WHERE id = $1", [sessionId]);
    if (s?.status !== "open") throw new ApiError(409, "session_ended", "This session has ended");
  }
}

function requireHost(p: Participant) {
  if (p.role !== "host") throw new ApiError(403, "host_only", "Only the host can do this");
}
