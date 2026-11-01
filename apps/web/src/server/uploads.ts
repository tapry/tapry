import {
  chunkStorageKey,
  type commitChunkBody,
  type completeTrackBody,
  type createTrackBody,
  type UploadUrlResponse,
  type uploadUrlBody,
} from "@opentake/shared";
import type { z } from "zod";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { newId } from "./ids";
import type { Participant } from "./live";
import type { Storage } from "./storage";

interface TrackRow {
  id: string;
  session_id: string;
  recording_id: string;
  participant_id: string;
  mime_type: string;
  status: "recording" | "complete" | "interrupted";
  last_seq: number | null;
  missing_seqs: number[] | null;
}

export interface TrackCompletion {
  trackId: string;
  status: "complete" | "interrupted";
  lastSeq: number;
  missingSeqs: number[];
}

/**
 * Server side of the chunk upload protocol (docs/decisions/0001-one-object-per-chunk.md).
 * Every method is idempotent: clients retry until they get a 2xx, so a repeated
 * call after a lost response must succeed with the same result.
 */
/** Slack for client clock-offset error when judging whether a track began before Stop. */
const LATE_TRACK_SLACK_MS = 10_000;

export class UploadService {
  constructor(
    private db: Db,
    private storage: Storage,
    /** Called when upload progress in a session changed (drives the host's progress view). */
    private onProgress: (sessionId: string) => void = () => {},
    /** Called when a track is fully uploaded (the last one triggers processing). */
    private onTrackDone: (recordingId: string) => void | Promise<void> = () => {},
  ) {}

  /**
   * Register a camera or mic track. Clients pick the id and start recording locally
   * before calling this, so a guest who is offline when Record is pressed still records;
   * they register (and upload) once they're back, possibly after Stop.
   */
  async createTrack(p: Participant, body: z.infer<typeof createTrackBody>) {
    const [recording] = await this.db.query<{ status: string; stopped_at: number | null; deleted_at: Date | null }>(
      "SELECT status, stopped_at, coalesce(deleted_at, raw_deleted_at) AS deleted_at FROM recordings WHERE id = $1 AND session_id = $2",
      [body.recordingId, p.sessionId],
    );
    if (!recording) throw new ApiError(404, "recording_not_found", "Recording not found");
    if (recording.deleted_at) throw recordingGone();
    const startedBeforeStop =
      recording.status === "recording" ||
      (recording.stopped_at !== null && body.startedAt <= recording.stopped_at + LATE_TRACK_SLACK_MS);
    if (!startedBeforeStop) {
      throw new ApiError(409, "recording_stopped", "This recording has already stopped");
    }

    const trackId = body.trackId ?? newId("trk");
    const inserted = await this.db.query(
      `INSERT INTO tracks (id, session_id, recording_id, participant_id, kind, mime_type, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [trackId, p.sessionId, body.recordingId, p.id, body.kind, body.mimeType, body.startedAt],
    );
    if (inserted.length === 0) {
      // A retry of the same registration is fine; anything else is an id collision or misuse.
      const [existing] = await this.db.query<{ participant_id: string; recording_id: string; kind: string }>(
        "SELECT participant_id, recording_id, kind FROM tracks WHERE id = $1",
        [trackId],
      );
      if (existing?.participant_id !== p.id || existing.recording_id !== body.recordingId || existing.kind !== body.kind) {
        throw new ApiError(409, "track_id_taken", "This track id is already in use");
      }
    }
    this.onProgress(p.sessionId);
    return { trackId };
  }

  async createUploadUrl(
    p: Participant,
    trackId: string,
    seq: number,
    body: z.infer<typeof uploadUrlBody>,
  ): Promise<UploadUrlResponse> {
    const track = await this.ownedTrack(p, trackId);
    const existing = await this.committedChunk(trackId, seq);
    if (existing) {
      if (existing.sha256 === body.sha256 && existing.bytes === body.bytes) return { committed: true };
      throw new ApiError(409, "chunk_conflict", `Chunk ${seq} was already committed with different content`);
    }
    if (track.status !== "recording") throw new ApiError(409, "track_closed", "Track is already complete");

    // The track's own mime type, not the request's: it is what the worker will expect.
    return this.storage.presignPut(chunkStorageKey(p.sessionId, trackId, seq), {
      bytes: body.bytes,
      sha256: body.sha256,
      contentType: track.mime_type,
    });
  }

  async commitChunk(p: Participant, trackId: string, seq: number, body: z.infer<typeof commitChunkBody>) {
    await this.ownedTrack(p, trackId);
    const key = chunkStorageKey(p.sessionId, trackId, seq);

    // Trust storage, not the client: the object must really be there, whole.
    const object = await this.storage.head(key);
    if (!object) throw new ApiError(409, "not_uploaded", `Chunk ${seq} is not in storage`);
    if (object.bytes !== body.bytes) {
      throw new ApiError(409, "size_mismatch", `Stored ${object.bytes} bytes, expected ${body.bytes}`);
    }
    if (object.sha256 && object.sha256 !== body.sha256) {
      throw new ApiError(409, "checksum_mismatch", `Stored chunk ${seq} does not match its checksum`);
    }

    const inserted = await this.db.query(
      `INSERT INTO chunks (track_id, seq, start_ts, end_ts, bytes, sha256, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (track_id, seq) DO NOTHING
       RETURNING seq`,
      [trackId, seq, body.startTs, body.endTs, body.bytes, body.sha256, key],
    );
    if (inserted.length === 0) {
      const existing = await this.committedChunk(trackId, seq);
      if (existing?.sha256 !== body.sha256) {
        throw new ApiError(409, "chunk_conflict", `Chunk ${seq} was already committed with different content`);
      }
    }
    this.onProgress(p.sessionId);
    return { seq };
  }

  async completeTrack(
    p: Participant,
    trackId: string,
    body: z.infer<typeof completeTrackBody>,
  ): Promise<TrackCompletion> {
    const owned = await this.ownedTrack(p, trackId);
    const result = await this.db.transaction(async (tx): Promise<TrackCompletion> => {
      const [track] = await tx.query<TrackRow>("SELECT * FROM tracks WHERE id = $1 FOR UPDATE", [trackId]);
      if (track!.status !== "recording") {
        return {
          trackId,
          status: track!.status,
          lastSeq: track!.last_seq ?? -1,
          missingSeqs: track!.missing_seqs ?? [],
        };
      }

      const [{ max_seq }] = (await tx.query<{ max_seq: number | null }>(
        "SELECT max(seq) AS max_seq FROM chunks WHERE track_id = $1",
        [trackId],
      )) as [{ max_seq: number | null }];
      // A crashed client sends null: every chunk it still had is uploaded by now,
      // so the highest committed seq is the real end of the recording.
      const lastSeq = Math.max(body.lastSeq ?? -1, max_seq ?? -1);
      const [{ missing }] = (await tx.query<{ missing: number[] | null }>(
        `SELECT array_agg(s ORDER BY s) AS missing FROM generate_series(0, $2::int) AS s
         WHERE NOT EXISTS (SELECT 1 FROM chunks WHERE track_id = $1 AND seq = s)`,
        [trackId, lastSeq],
      )) as [{ missing: number[] | null }];
      const missingSeqs = missing ?? [];
      const status = body.interrupted ? "interrupted" : "complete";

      // A gap is recorded, not rejected: the client has nothing left to send, so
      // refusing would only make it retry forever. The worker decides what to do.
      await tx.query(
        `UPDATE tracks SET status = $2, stopped_at = $3, last_seq = $4, missing_seqs = $5 WHERE id = $1`,
        [trackId, status, body.stoppedAt, lastSeq, missingSeqs],
      );
      return { trackId, status, lastSeq, missingSeqs };
    });
    this.onProgress(p.sessionId);
    await this.onTrackDone(owned.recording_id);
    return result;
  }

  private async ownedTrack(p: Participant, trackId: string) {
    const [track] = await this.db.query<TrackRow & { deleted_at: Date | null }>(
      `SELECT t.*, coalesce(r.deleted_at, r.raw_deleted_at) AS deleted_at FROM tracks t JOIN recordings r ON r.id = t.recording_id
       WHERE t.id = $1 AND t.session_id = $2 AND t.participant_id = $3`,
      [trackId, p.sessionId, p.id],
    );
    // Same 404 for "doesn't exist" and "not yours", so ids can't be probed.
    if (!track) throw new ApiError(404, "track_not_found", "Track not found");
    if (track.deleted_at) throw recordingGone();
    return track;
  }

  private async committedChunk(trackId: string, seq: number) {
    const [row] = await this.db.query<{ sha256: string; bytes: number }>(
      "SELECT sha256, bytes FROM chunks WHERE track_id = $1 AND seq = $2",
      [trackId, seq],
    );
    return row;
  }
}

/**
 * The host deleted the recording, or its originals were removed after the retention period
 * (an upload arriving that late can't join the processed files). 410 is the one answer that tells the recorder to drop its
 * local copy of the track (TrackGoneError) instead of retrying: nobody wants it any more.
 */
const recordingGone = () => new ApiError(410, "recording_deleted", "The host deleted this recording");
