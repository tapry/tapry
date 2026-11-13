// Share pages: a public page for one recording (its combined video or mix, and its transcript
// if the host says so), reachable only by a link with a secret in it, and an embeddable player
// of the same. Off for every recording until someone turns it on; turning it off, deleting the
// recording or making a new link kills the old one. Pages ask search engines not to index them.
import type { User } from "./auth";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { newInviteCode } from "./ids";
import { parseVtt } from "./library";

export interface ShareSettings {
  /** The link's secret; null when the recording isn't shared. */
  code: string | null;
  /** The transcript is shown on the page too. */
  transcript: boolean;
}

export interface SharedRecording {
  title: string;
  /** What plays: the combined video, or the mix of a recording without video. */
  media: "video" | "audio";
  lengthMs: number;
  /** Who said what, when the host shares the transcript and there is one. */
  turns: Array<{ speaker: string; startMs: number; text: string }> | null;
}

export class ShareService {
  constructor(
    private db: Db,
    private storage: {
      presignGet(key: string, opts: { fileName: string; contentType: string; ttlSeconds?: number }): Promise<string>;
      openRead(key: string): Promise<ReadableStream<Uint8Array>>;
    },
  ) {}

  private async owned(user: User, studioId: string, recordingId: string) {
    const [rec] = await this.db.query<{ share_code: string | null; share_transcript: boolean }>(
      `SELECT r.share_code, r.share_transcript FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.id = $1 AND st.id = $2 AND st.owner_id = $3 AND r.deleted_at IS NULL AND st.deleted_at IS NULL`,
      [recordingId, studioId, user.accountId],
    );
    if (!rec) throw new ApiError(404, "recording_not_found", "Recording not found");
    return rec;
  }

  async get(user: User, studioId: string, recordingId: string): Promise<ShareSettings> {
    const rec = await this.owned(user, studioId, recordingId);
    return { code: rec.share_code, transcript: rec.share_transcript };
  }

  /** Share or stop sharing. Sharing keeps the link it had; `newLink` replaces it, so the old one stops working. */
  async set(user: User, studioId: string, recordingId: string, body: { enabled: boolean; transcript: boolean; newLink?: boolean }): Promise<ShareSettings> {
    const rec = await this.owned(user, studioId, recordingId);
    const code = body.enabled ? (body.newLink || !rec.share_code ? newInviteCode() : rec.share_code) : null;
    await this.db.query("UPDATE recordings SET share_code = $2, share_transcript = $3 WHERE id = $1", [recordingId, code, body.transcript]);
    return { code, transcript: body.transcript };
  }

  private async byCode(code: string) {
    const [rec] = await this.db.query<{ id: string; number: number | null; started_at: number; stopped_at: number | null; share_transcript: boolean; studio: string }>(
      `SELECT r.id, r.number, r.started_at, r.stopped_at, r.share_transcript, st.name AS studio
       FROM recordings r JOIN sessions s ON s.id = r.session_id JOIN studios st ON st.id = s.studio_id
       WHERE r.share_code = $1 AND r.deleted_at IS NULL AND st.deleted_at IS NULL AND r.processing = 'ready'`,
      [code],
    );
    if (!rec) return null;
    const [media] = await this.db.query<{ storage_key: string; file_name: string; content_type: string; duration_ms: number | null }>(
      "SELECT storage_key, file_name, content_type, duration_ms FROM outputs WHERE recording_id = $1 AND kind = 'combined' LIMIT 1",
      [rec.id],
    );
    return media ? { rec, media } : null;
  }

  /** What the public page shows. Null for a link that is wrong, switched off or whose recording is gone. */
  async view(code: string): Promise<SharedRecording | null> {
    const found = await this.byCode(code);
    if (!found) return null;
    const { rec, media } = found;
    let turns: SharedRecording["turns"] = null;
    if (rec.share_transcript) {
      const [vtt] = await this.db.query<{ storage_key: string; bytes: string }>("SELECT storage_key, bytes FROM outputs WHERE recording_id = $1 AND kind = 'transcript' AND file_name = 'Transcript.vtt'", [rec.id]);
      if (vtt && Number(vtt.bytes) <= 4 * 1024 * 1024) {
        try {
          const chunks: Uint8Array[] = [];
          const reader = (await this.storage.openRead(vtt.storage_key)).getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          turns = parseVtt(Buffer.concat(chunks).toString("utf8")).map((c) => ({ speaker: c.speaker, startMs: c.startMs, text: c.text }));
        } catch {
          turns = null; // not readable right now: the page shows the player alone
        }
      }
    }
    return {
      title: `${rec.studio}${rec.number ? `, Recording ${rec.number}` : ""}`,
      media: media.file_name.toLowerCase().endsWith(".mp4") ? "video" : "audio",
      lengthMs: Number(media.duration_ms ?? 0) || Math.max(0, Number(rec.stopped_at ?? rec.started_at) - Number(rec.started_at)),
      turns,
    };
  }

  /** A signed link to what plays, for the page's player. Null like `view`. */
  async mediaUrl(code: string): Promise<string | null> {
    const found = await this.byCode(code);
    if (!found) return null;
    return this.storage.presignGet(found.media.storage_key, { fileName: found.media.file_name, contentType: found.media.content_type, ttlSeconds: 6 * 3600 });
  }
}
