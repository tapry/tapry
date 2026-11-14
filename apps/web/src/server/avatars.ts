// Profile pictures for the people of an account (hosts and members). Small, kept in the
// database like studio logos, served from this server as an image and nothing else. Guests
// have no account and no picture: they stay initials.
import { createHash } from "node:crypto";
import type { User } from "./auth";
import { sniffImage } from "./brand";
import type { Db } from "./db";
import { ApiError } from "./errors";

/** The settings page shrinks a picture to 256 px before sending it, so this is generous. */
export const AVATAR_MAX_BYTES = 256 * 1024;

/** Where a person's picture is served, or null when they have none. Versioned by its hash, so it can be cached for good. */
export const avatarUrl = (userId: string, hash: string | null | undefined) => (hash ? `/api/avatars/${userId}?v=${hash.slice(0, 16)}` : null);

export class AvatarService {
  constructor(private db: Db) {}

  async set(user: User, bytes: Uint8Array): Promise<{ avatarUrl: string }> {
    if (user.apiKey) throw new ApiError(403, "not_for_keys", "This can't be done with an API key");
    if (bytes.byteLength === 0) throw new ApiError(400, "avatar_empty", "That file is empty.");
    if (bytes.byteLength > AVATAR_MAX_BYTES) throw new ApiError(413, "avatar_too_big", "The picture can be 256 KB at most.");
    const type = sniffImage(bytes);
    if (!type) throw new ApiError(415, "avatar_type", "The picture must be a PNG, JPEG or WebP image.");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO user_avatars (user_id, image, type) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET image = EXCLUDED.image, type = EXCLUDED.type`,
        [user.id, Buffer.from(bytes).toString("base64"), type],
      );
      await tx.query("UPDATE users SET avatar_hash = $2 WHERE id = $1", [user.id, hash]);
    });
    return { avatarUrl: avatarUrl(user.id, hash)! };
  }

  async remove(user: User): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query("DELETE FROM user_avatars WHERE user_id = $1", [user.id]);
      await tx.query("UPDATE users SET avatar_hash = NULL WHERE id = $1", [user.id]);
    });
  }

  /** The picture's bytes, for anyone who has the address: a guest sees their host's on the invite. */
  async get(userId: string): Promise<{ bytes: Uint8Array; type: string } | null> {
    const [row] = await this.db.query<{ image: string; type: string }>("SELECT image, type FROM user_avatars WHERE user_id = $1", [userId]);
    return row ? { bytes: Buffer.from(row.image, "base64"), type: row.type } : null;
  }
}
