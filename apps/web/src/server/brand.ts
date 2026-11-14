// Studio branding: a logo and an accent colour the studio's guests see on the pages they open
// (invite, tech check, green room, solo link, share page). The host's dashboard is never
// re-coloured. The logo is small and kept in the database, so it follows the backups and needs
// no storage of its own; it is served from this server, as an image and nothing else.
import { createHash } from "node:crypto";
import type { User } from "./auth";
import type { Db } from "./db";
import { ApiError } from "./errors";

export const LOGO_MAX_BYTES = 512 * 1024;

/** What a guest page needs to wear a studio's brand. */
export interface Brand {
  /** "#rrggbb", or null for Tapry's own. */
  accent: string | null;
  /** The colour of text on the accent: white or near-black, whichever reads better. */
  accentText: string | null;
  /** Path of the logo on this server, or null for Tapry's mark. */
  logoUrl: string | null;
}

export interface BrandSettings extends Brand {
  /** The account may brand its studios (its plan, on Tapry Cloud). */
  allowed: boolean;
}

/** The image types a logo may be, told from the file's first bytes, never from what the browser says. */
export function sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const at = (i: number, ...v: number[]) => v.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** White or near-black, by which has the higher contrast against the colour (WCAG relative luminance). */
export function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.064 ? "#ffffff" : "#18181b";
}

interface Row {
  studio_id: string;
  owner_id: string;
  accent: string | null;
  logo_hash: string | null;
}

export class BrandService {
  constructor(
    private db: Db,
    /** Whether this account may brand its studios. Always on a self-hosted server. */
    private allows: (accountId: string) => Promise<boolean> = async () => true,
  ) {}

  private async owned(user: User, studioId: string) {
    const [row] = await this.db.query<{ id: string }>("SELECT id FROM studios WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [studioId, user.accountId]);
    if (!row) throw new ApiError(404, "studio_not_found", "Studio not found");
  }

  private async check(user: User, studioId: string) {
    await this.owned(user, studioId);
    if (!(await this.allows(user.accountId))) throw new ApiError(402, "plan_no_branding", "Studio branding is part of the Studio plan and up.");
  }

  private toBrand(row: Row | undefined): Brand {
    return {
      accent: row?.accent ?? null,
      accentText: row?.accent ? textOn(row.accent) : null,
      logoUrl: row?.logo_hash ? `/api/brand/${row.studio_id}/logo?v=${row.logo_hash.slice(0, 16)}` : null,
    };
  }

  /** The brand guests of a studio see, looked up by one column of a live studio. Null: Tapry's own look. */
  private async find(where: string, value: string): Promise<Brand | null> {
    const [row] = await this.db.query<Row>(
      `SELECT st.id AS studio_id, st.owner_id, b.accent, b.logo_hash FROM studios st JOIN studio_brands b ON b.studio_id = st.id
       WHERE ${where} AND st.deleted_at IS NULL`,
      [value],
    );
    if (!row || (!row.accent && !row.logo_hash)) return null;
    // A smaller plan since: the brand is kept, and not shown.
    if (!(await this.allows(row.owner_id))) return null;
    return this.toBrand(row);
  }

  forInvite(inviteCode: string) {
    return this.find("st.invite_code = $1", inviteCode);
  }
  forSolo(code: string) {
    return this.find("st.solo_code = $1", code);
  }
  forSession(sessionId: string) {
    return this.find("st.id = (SELECT studio_id FROM sessions WHERE id = $1)", sessionId);
  }
  forShare(code: string) {
    return this.find("st.id = (SELECT s.studio_id FROM recordings r JOIN sessions s ON s.id = r.session_id WHERE r.share_code = $1 AND r.deleted_at IS NULL)", code);
  }

  /** The studio's settings page. */
  async view(user: User, studioId: string): Promise<BrandSettings> {
    await this.owned(user, studioId);
    const [row] = await this.db.query<Row>("SELECT studio_id, '' AS owner_id, accent, logo_hash FROM studio_brands WHERE studio_id = $1", [studioId]);
    return { ...this.toBrand(row), allowed: await this.allows(user.accountId) };
  }

  /** Clearing is always possible, whatever the plan. */
  async setAccent(user: User, studioId: string, accent: string | null): Promise<BrandSettings> {
    if (accent) await this.check(user, studioId);
    else await this.owned(user, studioId);
    await this.db.query(
      `INSERT INTO studio_brands (studio_id, accent) VALUES ($1, $2)
       ON CONFLICT (studio_id) DO UPDATE SET accent = EXCLUDED.accent, updated_at = now()`,
      [studioId, accent?.toLowerCase() ?? null],
    );
    return this.view(user, studioId);
  }

  async setLogo(user: User, studioId: string, bytes: Uint8Array): Promise<BrandSettings> {
    await this.check(user, studioId);
    if (bytes.byteLength === 0) throw new ApiError(400, "logo_empty", "That file is empty.");
    if (bytes.byteLength > LOGO_MAX_BYTES) throw new ApiError(413, "logo_too_big", "The logo can be 512 KB at most.");
    const type = sniffImage(bytes);
    if (!type) throw new ApiError(415, "logo_type", "The logo must be a PNG, JPEG or WebP image.");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await this.db.query(
      `INSERT INTO studio_brands (studio_id, logo, logo_type, logo_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (studio_id) DO UPDATE SET logo = EXCLUDED.logo, logo_type = EXCLUDED.logo_type, logo_hash = EXCLUDED.logo_hash, updated_at = now()`,
      [studioId, Buffer.from(bytes).toString("base64"), type, hash],
    );
    return this.view(user, studioId);
  }

  async removeLogo(user: User, studioId: string): Promise<BrandSettings> {
    await this.owned(user, studioId);
    await this.db.query("UPDATE studio_brands SET logo = NULL, logo_type = NULL, logo_hash = NULL, updated_at = now() WHERE studio_id = $1", [studioId]);
    return this.view(user, studioId);
  }

  /** The logo's bytes, for anyone who has the studio's id: guests see it before they have a token. */
  async logo(studioId: string): Promise<{ bytes: Uint8Array; type: string; hash: string } | null> {
    const [row] = await this.db.query<{ logo: string | null; logo_type: string | null; logo_hash: string | null }>(
      `SELECT b.logo, b.logo_type, b.logo_hash FROM studio_brands b JOIN studios st ON st.id = b.studio_id
       WHERE b.studio_id = $1 AND st.deleted_at IS NULL`,
      [studioId],
    );
    if (!row?.logo || !row.logo_type || !row.logo_hash) return null;
    return { bytes: Buffer.from(row.logo, "base64"), type: row.logo_type, hash: row.logo_hash };
  }
}
