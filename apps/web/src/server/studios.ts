import {
  consentTextFor,
  studioSettings,
  type createStudioBody,
  type joinBody,
  type SessionTicket,
  type StudioSettings,
  type TechCheckResult,
  type techCheckReport,
  type updateStudioBody,
} from "@tapry/shared";
import type { z } from "zod";
import type { User } from "./auth";
import type { Db, Queryable } from "./db";
import { ApiError } from "./errors";
import { hashToken, newId, newInviteCode, newToken, sha256Hex } from "./ids";
import type { LiveService } from "./live";
import { deleteRecordingIn, RECORDING_BYTES } from "./processing";
import { drainBody } from "./speed-test";

export interface Studio {
  id: string;
  name: string;
  inviteCode: string;
  settings: StudioSettings;
  createdAt: string;
}

export interface TechCheck {
  id: string;
  name: string;
  browser: string;
  checks: TechCheckResult[];
  checkedAt: number;
}

export interface StudioWithUsage extends Studio {
  recordings: number;
  /** A recording is running in it right now. */
  live: boolean;
  /** Space its recordings use in storage. */
  bytes: number;
}

export type { SessionTicket };

export class StudioService {
  constructor(
    private db: Db,
    private live: LiveService,
    /** A purge job was queued (lets an in-process worker start it now). */
    private onPurgeQueued: () => void = () => {},
    /** Where a new session of this owner records: their own storage target, or null for the server's. May refuse. */
    private storageTargetFor: (tx: Queryable, ownerId: string) => Promise<string | null> = async () => null,
    /** Whether this account's studios may record in 4K (its plan, on Tapry Cloud). */
    private allows4k: (accountId: string) => Promise<boolean> = async () => true,
  ) {}

  /** Choosing 4K needs a plan that has it. Only asked when the setting is being turned on. */
  private async check4k(accountId: string, settings: StudioSettings, before?: StudioSettings) {
    if (settings.videoQuality !== "2160p" || before?.videoQuality === "2160p") return;
    if (!(await this.allows4k(accountId))) throw new ApiError(402, "plan_no_4k", "4K recording is part of the Studio plan and up. This studio can record in Full HD.");
  }

  /**
   * The settings a session runs with. A 4K studio whose account no longer has 4K (a smaller
   * plan since) records in Full HD; the studio's own setting is left as it was.
   */
  private async sessionSettings(raw: unknown, accountId: string): Promise<StudioSettings> {
    const settings = studioSettings.parse(raw);
    if (settings.videoQuality === "2160p" && !(await this.allows4k(accountId))) return { ...settings, videoQuality: "1080p" };
    return settings;
  }

  async create(owner: User, body: z.infer<typeof createStudioBody>): Promise<Studio> {
    const settings = studioSettings.parse(body.settings ?? {});
    await this.check4k(owner.accountId, settings);
    const [row] = await this.db.query<StudioRow>(
      "INSERT INTO studios (id, owner_id, name, invite_code, settings) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [newId("std"), owner.accountId, body.name, newInviteCode(), settings],
    );
    return toStudio(row!);
  }

  async list(owner: User): Promise<StudioWithUsage[]> {
    const rows = await this.db.query<StudioRow & { recordings: number; bytes: number; live: boolean }>(
      `SELECT st.*,
              count(r.id)::int AS recordings,
              coalesce(bool_or(r.status = 'recording'), false) AS live,
              coalesce(sum(${RECORDING_BYTES}), 0)::bigint AS bytes
       FROM studios st
       LEFT JOIN sessions s ON s.studio_id = st.id
       LEFT JOIN recordings r ON r.session_id = s.id AND r.deleted_at IS NULL
       WHERE st.owner_id = $1 AND st.deleted_at IS NULL
       GROUP BY st.id
       ORDER BY st.created_at DESC`,
      [owner.accountId],
    );
    return rows.map((r) => ({ ...toStudio(r), recordings: r.recordings, bytes: r.bytes, live: r.live }));
  }

  /**
   * Delete a studio with all its recordings and their files. Its open session ends and the
   * guest link stops working. Refused (nothing deleted) while a recording is running or
   * being processed.
   */
  async delete(owner: User, studioId: string) {
    await this.owned(owner, studioId);
    const sessions = await this.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM studios WHERE id = $1 FOR UPDATE", [studioId]);
      const recordings = await tx.query<{ id: string }>(
        `SELECT r.id FROM recordings r JOIN sessions s ON s.id = r.session_id
         WHERE s.studio_id = $1 AND r.deleted_at IS NULL`,
        [studioId],
      );
      for (const r of recordings) await deleteRecordingIn(tx, r.id);
      const open = await tx.query<{ id: string }>(
        "UPDATE sessions SET status = 'ended', ended_at = now() WHERE studio_id = $1 AND status = 'open' RETURNING id",
        [studioId],
      );
      await tx.query("DELETE FROM tech_checks WHERE studio_id = $1", [studioId]);
      // A fresh random code frees the old one and keeps the row from matching any link.
      await tx.query("UPDATE studios SET deleted_at = now(), invite_code = $2 WHERE id = $1", [studioId, newInviteCode()]);
      return open.map((s) => s.id);
    });
    for (const id of sessions) await this.live.publish(id);
    this.onPurgeQueued();
  }

  async get(owner: User, studioId: string): Promise<Studio> {
    return toStudio(await this.owned(owner, studioId));
  }

  async update(owner: User, studioId: string, body: z.infer<typeof updateStudioBody>): Promise<Studio> {
    const current = await this.owned(owner, studioId);
    const settings = studioSettings.parse({ ...current.settings, ...body.settings });
    await this.check4k(owner.accountId, settings, studioSettings.parse(current.settings));
    const [row] = await this.db.query<StudioRow>(
      "UPDATE studios SET name = $2, settings = $3 WHERE id = $1 RETURNING *",
      [studioId, body.name ?? current.name, settings],
    );
    return toStudio(row!);
  }

  /** New guest link. Old links stop working; guests already in a session keep their tokens. */
  async rotateInvite(owner: User, studioId: string): Promise<Studio> {
    await this.owned(owner, studioId);
    const [row] = await this.db.query<StudioRow>("UPDATE studios SET invite_code = $2 WHERE id = $1 RETURNING *", [
      studioId,
      newInviteCode(),
    ]);
    return toStudio(row!);
  }

  /**
   * Host enters the studio: reuses the open session or starts one, and issues a host
   * token. A host who opens a second tab gets a fresh token; the old one stops working.
   */
  async openAsHost(owner: User, studioId: string): Promise<SessionTicket> {
    const studio = await this.owned(owner, studioId);
    const ticket = await this.db.transaction(async (tx) => {
      const sessionId = await openSession(tx, studioId, () => this.storageTargetFor(tx, owner.accountId));
      const token = newToken();
      const [existing] = await tx.query<{ id: string }>(
        "UPDATE participants SET token_hash = $3 WHERE session_id = $1 AND user_id = $2 AND role = 'host' RETURNING id",
        [sessionId, owner.id, hashToken(token)],
      );
      const participantId = existing?.id ?? newId("par");
      if (!existing) {
        await tx.query(
          `INSERT INTO participants (id, session_id, user_id, display_name, role, token_hash)
           VALUES ($1, $2, $3, $4, 'host', $5)`,
          [participantId, sessionId, owner.id, owner.name, hashToken(token)],
        );
      }
      return { sessionId, participantId, token, role: "host" as const };
    });
    await this.live.publish(ticket.sessionId);
    return { ...ticket, studio: { name: studio.name, settings: await this.sessionSettings(studio.settings, owner.accountId) } };
  }

  /**
   * What a guest sees before joining: the studio's name and who invited them. Null for a link
   * that is wrong, replaced or deleted. Anyone with the link may see this, like the link itself.
   */
  async invitePreview(
    inviteCode: string,
  ): Promise<{ studioName: string; hostName: string; settings: StudioSettings; consentText: string; consentHash: string } | null> {
    const [row] = await this.db.query<{ name: string; host: string; settings: unknown; owner_id: string }>(
      `SELECT st.name, st.settings, st.owner_id, u.name AS host FROM studios st JOIN users u ON u.id = st.owner_id
       WHERE st.invite_code = $1 AND st.deleted_at IS NULL`,
      [inviteCode],
    );
    if (!row) return null;
    const settings = await this.sessionSettings(row.settings, row.owner_id);
    const consentText = consentTextFor(settings, row.host);
    return { studioName: row.name, hostName: row.host, settings, consentText, consentHash: sha256Hex(consentText) };
  }

  /** The studio an invite code belongs to, for the tech check; 404 for a dead link. */
  private async studioForInvite(inviteCode: string) {
    const [row] = await this.db.query<{ id: string }>("SELECT id FROM studios WHERE invite_code = $1 AND deleted_at IS NULL", [inviteCode]);
    if (!row) throw new ApiError(404, "invite_not_found", "This invite link is invalid or has been replaced");
    return row.id;
  }

  /** Upload-speed test for the tech check: read and drop the body. Only for a live invite code. */
  async speedTest(inviteCode: string, body: ReadableStream<Uint8Array> | null, maxBytes: number) {
    await this.studioForInvite(inviteCode);
    return { bytes: await drainBody(body, maxBytes) };
  }

  /** A guest sends their tech-check results to the host. Sending again updates the same report. */
  async reportTechCheck(inviteCode: string, body: z.infer<typeof techCheckReport>) {
    const studioId = await this.studioForInvite(inviteCode);
    await this.db.transaction(async (tx) => {
      const [taken] = await tx.query<{ studio_id: string }>("SELECT studio_id FROM tech_checks WHERE id = $1", [body.reportId]);
      if (taken && taken.studio_id !== studioId) throw new ApiError(409, "report_id_taken", "This report id is already in use");
      await tx.query(
        `INSERT INTO tech_checks (id, studio_id, name, browser, checks) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET name = $3, browser = $4, checks = $5, created_at = now()`,
        [body.reportId, studioId, body.name, body.browser, JSON.stringify(body.checks)],
      );
      // Keep the newest 50 per studio: enough for any real schedule, bounded for a leaked link.
      await tx.query(
        `DELETE FROM tech_checks WHERE studio_id = $1 AND id NOT IN (
           SELECT id FROM tech_checks WHERE studio_id = $1 ORDER BY created_at DESC, id LIMIT 50)`,
        [studioId],
      );
    });
  }

  /** The studio's tech checks from the last 30 days, newest first (for the host). */
  async techChecks(owner: User, studioId: string): Promise<TechCheck[]> {
    await this.owned(owner, studioId);
    const rows = await this.db.query<{ id: string; name: string; browser: string; checks: TechCheckResult[]; created_at: Date }>(
      `SELECT id, name, browser, checks, created_at FROM tech_checks
       WHERE studio_id = $1 AND created_at > now() - interval '30 days' ORDER BY created_at DESC, id LIMIT 20`,
      [studioId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, browser: r.browser, checks: r.checks, checkedAt: new Date(r.created_at).getTime() }));
  }

  /** Guest opens the invite link. No account; consent to recording is required by the schema. */
  async join(body: z.infer<typeof joinBody>): Promise<SessionTicket> {
    const [studio] = await this.db.query<StudioRow & { host: string }>(
      `SELECT st.*, u.name AS host FROM studios st JOIN users u ON u.id = st.owner_id
       WHERE st.invite_code = $1 AND st.deleted_at IS NULL`,
      [body.inviteCode],
    );
    if (!studio) throw new ApiError(404, "invite_not_found", "This invite link is invalid or has been replaced");
    const settings = await this.sessionSettings(studio.settings, studio.owner_id);
    // What they agree to is the studio's text as of now; the page tells us which text it showed.
    const consentText = consentTextFor(settings, studio.host);
    const consentHash = sha256Hex(consentText);
    if (body.consentHash && body.consentHash !== consentHash) {
      throw new ApiError(409, "consent_changed", "The host has just changed what you're agreeing to. Read it again, then join.");
    }

    const ticket = await this.db.transaction(async (tx) => {
      const [session] = await tx.query<{ id: string }>(
        "SELECT id FROM sessions WHERE studio_id = $1 AND status = 'open' FOR UPDATE",
        [studio.id],
      );
      // Guests can only join once the host has opened the studio.
      if (!session) throw new ApiError(409, "host_not_here", "The host hasn't opened the studio yet");

      // Counts everyone who ever joined, not who is connected right now: presence comes
      // with the live call. Guests rejoin with their saved token instead of joining again.
      const [{ guests }] = (await tx.query<{ guests: number }>(
        "SELECT count(*)::int AS guests FROM participants WHERE session_id = $1 AND role = 'guest'",
        [session.id],
      )) as [{ guests: number }];
      if (guests >= settings.maxGuests) throw new ApiError(409, "studio_full", "This studio is full");

      const participantId = newId("par");
      const token = newToken();
      await tx.query("INSERT INTO consent_texts (hash, text) VALUES ($1, $2) ON CONFLICT (hash) DO NOTHING", [consentHash, consentText]);
      await tx.query(
        `INSERT INTO participants (id, session_id, display_name, role, token_hash, consented_at, consent_hash)
         VALUES ($1, $2, $3, 'guest', $4, now(), $5)`,
        [participantId, session.id, body.displayName, hashToken(token), consentHash],
      );
      return { sessionId: session.id, participantId, token, role: "guest" as const };
    });
    await this.live.publish(ticket.sessionId);
    return { ...ticket, studio: { name: studio.name, settings } };
  }

  private async owned(owner: User, studioId: string) {
    const [row] = await this.db.query<StudioRow>("SELECT * FROM studios WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [
      studioId,
      owner.accountId,
    ]);
    // 404 for "not yours" too, so studio ids can't be probed.
    if (!row) throw new ApiError(404, "studio_not_found", "Studio not found");
    return row;
  }
}

async function openSession(tx: Queryable, studioId: string, storageTarget: () => Promise<string | null>): Promise<string> {
  await tx.query("SELECT id FROM studios WHERE id = $1 FOR UPDATE", [studioId]);
  const [open] = await tx.query<{ id: string }>("SELECT id FROM sessions WHERE studio_id = $1 AND status = 'open'", [
    studioId,
  ]);
  if (open) return open.id;
  const id = newId("ses");
  // Decided once, here: everything this session records lives in that storage for good.
  await tx.query("INSERT INTO sessions (id, studio_id, storage_target_id) VALUES ($1, $2, $3)", [id, studioId, await storageTarget()]);
  return id;
}

interface StudioRow {
  id: string;
  owner_id: string;
  name: string;
  invite_code: string;
  settings: Partial<StudioSettings>;
  created_at: Date;
}

const toStudio = (r: StudioRow): Studio => ({
  id: r.id,
  name: r.name,
  inviteCode: r.invite_code,
  settings: studioSettings.parse(r.settings),
  createdAt: new Date(r.created_at).toISOString(),
});
