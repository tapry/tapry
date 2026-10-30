import type { CallToken } from "@opentake/shared";
import { AccessToken } from "livekit-server-sdk";
import type { Db } from "./db";
import { ApiError } from "./errors";
import type { Participant } from "./live";

export interface CallConfig {
  /** WebSocket URL browsers use, e.g. wss://call.example.com (ws://localhost:7880 in dev). */
  url: string;
  apiKey: string;
  apiSecret: string;
}

const TOKEN_TTL = "6h";

/**
 * The live call: lets participants see and hear each other through LiveKit. It is
 * separate from recording, which never depends on it. Each session is one LiveKit
 * room; a token admits one participant, under their own identity, to their own session.
 */
export class CallService {
  constructor(
    private db: Db,
    private config: CallConfig | null,
  ) {}

  async token(p: Participant): Promise<CallToken> {
    if (!this.config) return { enabled: false };
    const [row] = await this.db.query<{ display_name: string; status: string }>(
      `SELECT p.display_name, s.status FROM participants p JOIN sessions s ON s.id = p.session_id
       WHERE p.id = $1`,
      [p.id],
    );
    if (!row) throw new ApiError(404, "participant_not_found", "Participant not found");
    if (row.status !== "open") throw new ApiError(409, "session_ended", "This session has ended");

    const at = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      identity: p.id,
      name: row.display_name,
      ttl: TOKEN_TTL,
      metadata: JSON.stringify({ role: p.role }),
    });
    at.addGrant({
      room: p.sessionId,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      // Session control goes through our API, not LiveKit data messages.
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    return { enabled: true, url: this.config.url, token: await at.toJwt(), room: p.sessionId };
  }
}
