import {
  chunkStorageKey,
  type commitChunkBody,
  type completeTrackBody,
  type createTrackBody,
  type UploadUrlResponse,
  type uploadUrlBody,
} from "@tapry/shared";
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
/**
 * How long after Stop a recording still takes uploads: a guest who was offline can come back
 * days later, but not weeks, when their token could otherwise add a track to a long-finished
 * recording. Chunks still on a device after this stay there (the queue keeps trying).
 */
export const UPLOAD_GRACE_DAYS = 7;
const UPLOAD_GRACE_MS = UPLOAD_GRACE_DAYS * 86_400_000;
/** Tracks one person may register in one recording: a restart or rejoin adds a few, never dozens. */
export const MAX_TRACKS_PER_PERSON = 50;
/**
 * Bytes one person may upload per second of recording (plus ten minutes' worth): 32 Mbit/s,
 * four times what 1080p video with audio takes. Stops a guest filling the disk.
 */
export const BYTES_PER_SECOND_CAP = 4 * 1024 * 1024;
const QUOTA_SLACK_S = 600;
/** The most a "complete" may say was recorded beyond the last committed chunk (missing seqs are listed one by one). */
const MAX_SEQ_GAP = 10_000;

export interface UploadServiceOptions {
  now?: () => number;
  bytesPerSecondCap?: number;
}

export class UploadService {
  private now: () => number;
  private bytesPerSecond: number;

  constructor(
    private db: Db,
    private storage: Storage,
    /** Called when upload progress in a session changed (drives the host's progress view). */
    private onProgress: (sessionId: string) => void = () => {},
    /** Called when a track is fully uploaded (the last one triggers processing). */
    private onTrackDone: (recordingId: string) => void | Promise<void> = () => {},
    opts: UploadServiceOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.bytesPerSecond = opts.bytesPerSecondCap ?? BYTES_PER_SECOND_CAP;
  }

  /**
   * Register a camera or mic track. Clients pick the id and start recording locally
   * before calling this, so a guest who is offline when Record is pressed still records;
   * they register (and upload) once they're back, possibly after Stop.
   */
  async createTrack(p: Participant, body: z.infer<typeof createTrackBody>) {
    const [recording] = await this.db.query<{ status: string; started_at: number; stopped_at: number | null; deleted_at: Date | null; mine: number }>(
      `SELECT status, started_at, stopped_at, coalesce(deleted_at, raw_deleted_at) AS deleted_at,
              (SELECT count(*)::int FROM tracks t WHERE t.recording_id = r.id AND t.participant_id = $3) AS mine
       FROM recordings r WHERE id = $1 AND session_id = $2`,
      [body.recordingId, p.sessionId, p.id],
    );
    if (!recording) throw new ApiError(404, "recording_not_found", "Recording not found");
    if (recording.deleted_at) throw recordingGone();
    this.checkOpen(recording);
    // A track began while the recording ran: not before Record (clock error aside), not after Stop.
    const startedBeforeStop =
      recording.status === "recording" ||
      (recording.stopped_at !== null && body.startedAt <= recording.stopped_at + LATE_TRACK_SLACK_MS);
    if (!startedBeforeStop) {
      throw new ApiError(409, "recording_stopped", "This recording has already stopped");
    }
    if (body.startedAt < recording.started_at - LATE_TRACK_SLACK_MS) {
      throw new ApiError(409, "track_too_early", "This track began before the recording did");
    }
    const trackId = body.trackId ?? newId("trk");
    if (recording.mine >= MAX_TRACKS_PER_PERSON) {
      const [known] = await this.db.query("SELECT 1 FROM tracks WHERE id = $1 AND participant_id = $2", [trackId, p.id]);
      if (!known) throw new ApiError(429, "too_many_tracks", "Too many tracks for one person in this recording");
    }
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
    this.checkOpen(track);
    await this.checkQuota(p, track, body.bytes);

    // The track's own mime type, not the request's: it is what the worker will expect.
    return this.storage.presignPut(chunkStorageKey(p.sessionId, trackId, seq), {
      bytes: body.bytes,
      sha256: body.sha256,
      contentType: track.mime_type,
    });
  }

  async commitChunk(p: Participant, trackId: string, seq: number, body: z.infer<typeof commitChunkBody>) {
    this.checkOpen(await this.ownedTrack(p, trackId));
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
    this.checkOpen(owned);
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
      if (body.lastSeq !== null && body.lastSeq > (max_seq ?? -1) + MAX_SEQ_GAP) {
        throw new ApiError(400, "last_seq_too_high", "lastSeq is far beyond the last uploaded chunk");
      }
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

  /** Uploads stop UPLOAD_GRACE_DAYS after Stop (see above). */
  private checkOpen(rec: { stopped_at: number | null }) {
    if (rec.stopped_at !== null && this.now() > rec.stopped_at + UPLOAD_GRACE_MS) {
      throw new ApiError(409, "recording_closed", `This recording stopped more than ${UPLOAD_GRACE_DAYS} days ago and takes no more uploads`);
    }
  }

  /** This person's committed bytes in the recording, plus this chunk, against what its length allows. */
  private async checkQuota(p: Participant, track: TrackRow & { started_at: number; stopped_at: number | null }, bytes: number) {
    const [{ used }] = (await this.db.query<{ used: string }>(
      `SELECT coalesce(sum(c.bytes), 0)::text AS used FROM chunks c JOIN tracks t ON t.id = c.track_id
       WHERE t.recording_id = $1 AND t.participant_id = $2`,
      [track.recording_id, p.id],
    )) as [{ used: string }];
    const elapsedS = Math.max(0, (track.stopped_at ?? this.now()) - track.started_at) / 1000;
    const allowance = this.bytesPerSecond * (elapsedS + QUOTA_SLACK_S);
    if (Number(used) + bytes > allowance) {
      throw new ApiError(413, "upload_quota", "This person has uploaded more than a recording of this length can hold");
    }
  }

  private async ownedTrack(p: Participant, trackId: string) {
    const [track] = await this.db.query<TrackRow & { deleted_at: Date | null; started_at: number; stopped_at: number | null }>(
      `SELECT t.*, coalesce(r.deleted_at, r.raw_deleted_at) AS deleted_at, r.started_at, r.stopped_at
       FROM tracks t JOIN recordings r ON r.id = t.recording_id
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
