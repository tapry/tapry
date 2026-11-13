// The host's guide (run of show) and markers.
// - A studio's guide is the host's own plan for a session: sections and questions, one per line.
//   Guests never get it: it isn't in the studio's settings or the ticket, only hosts can read it.
// - A marker is a named moment in a recording ("Question 3", "Good quote"), set by a host while
//   it runs: by ticking a guide item, or with the Mark button. Markers go into the timeline
//   exports, so an editor finds those moments. They are deleted with their recording.
import type { User } from "./auth";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { newId } from "./ids";
import type { Participant } from "./live";

export const GUIDE_MAX_CHARS = 8000;
/** Markers one recording may hold: a few hundred is a long, heavily marked session. */
export const MAX_MARKERS = 500;

export interface Marker {
  id: string;
  /** Milliseconds from the recording's start. */
  atMs: number;
  label: string;
}

export class GuideService {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  async get(user: User, studioId: string): Promise<string> {
    const [row] = await this.db.query<{ guide: string }>("SELECT guide FROM studios WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [studioId, user.accountId]);
    if (!row) throw new ApiError(404, "studio_not_found", "Studio not found");
    return row.guide;
  }

  async set(user: User, studioId: string, guide: string): Promise<string> {
    const [row] = await this.db.query<{ guide: string }>(
      "UPDATE studios SET guide = $3 WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL RETURNING guide",
      [studioId, user.accountId, guide],
    );
    if (!row) throw new ApiError(404, "studio_not_found", "Studio not found");
    return row.guide;
  }

  /** The guide of the studio a host is in a session of. Hosts only: it is theirs, not the guests'. */
  async forHost(p: Participant): Promise<string> {
    // Someone recording alone gets what they were asked to talk about, never the host's own guide.
    if (p.solo && p.role !== "host") {
      const [row] = await this.db.query<{ solo_prompt: string }>("SELECT st.solo_prompt FROM sessions s JOIN studios st ON st.id = s.studio_id WHERE s.id = $1", [p.sessionId]);
      return row?.solo_prompt ?? "";
    }
    if (p.role !== "host") throw new ApiError(403, "forbidden", "The guide is the host's");
    const [row] = await this.db.query<{ guide: string }>("SELECT st.guide FROM sessions s JOIN studios st ON st.id = s.studio_id WHERE s.id = $1", [p.sessionId]);
    return row?.guide ?? "";
  }

  /** Mark this moment of the running recording. Timed by the server's clock, like everything else. */
  async mark(p: Participant, label: string): Promise<Marker> {
    if (p.role !== "host" && !p.solo) throw new ApiError(403, "forbidden", "Only a host can set markers");
    const [rec] = await this.db.query<{ id: string; started_at: number; markers: number }>(
      `SELECT r.id, r.started_at, (SELECT count(*)::int FROM markers m WHERE m.recording_id = r.id) AS markers
       FROM recordings r WHERE r.session_id = $1 AND r.status = 'recording' AND r.deleted_at IS NULL`,
      [p.sessionId],
    );
    if (!rec) throw new ApiError(409, "not_recording", "Markers are set while a recording runs");
    if (rec.markers >= MAX_MARKERS) throw new ApiError(429, "too_many_markers", "This recording has all the markers it can hold");
    const marker = { id: newId("mrk"), atMs: Math.max(0, Math.round(this.now() - Number(rec.started_at))), label };
    await this.db.query("INSERT INTO markers (id, recording_id, participant_id, at_ms, label) VALUES ($1, $2, $3, $4, $5)", [marker.id, rec.id, p.id, marker.atMs, label]);
    return marker;
  }

  /** A recording's markers in order, for its page and the timeline exports. */
  async markers(user: User, recordingId: string): Promise<Marker[]> {
    const rows = await this.db.query<{ id: string; at_ms: number; label: string }>(
      `SELECT m.id, m.at_ms, m.label FROM markers m JOIN recordings r ON r.id = m.recording_id
       JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE m.recording_id = $1 AND st.owner_id = $2 AND r.deleted_at IS NULL AND st.deleted_at IS NULL
       ORDER BY m.at_ms, m.created_at`,
      [recordingId, user.accountId],
    );
    return rows.map((r) => ({ id: r.id, atMs: Number(r.at_ms), label: r.label }));
  }
}
