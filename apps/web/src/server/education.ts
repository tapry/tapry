// Education accounts (Tapry Cloud only): teachers, students and researchers at a school or
// university. A verified education account gets more free recording hours and a discount on
// paid plans. Verified by itself when the owner's confirmed email address is on an academic
// domain; anything else is a request an admin approves by hand. A self-hosted server has no
// plans, so none of this exists there.
import { EDUCATION_DISCOUNT_PERCENT, EDUCATION_FREE_HOURS, type EducationStatus } from "@tapry/shared";
import type { User } from "./auth";
import type { Db } from "./db";
import { ApiError } from "./errors";

/**
 * An address at a school or university, by its domain: `.edu`, or an `ac`/`edu` label before a
 * country (`ox.ac.uk`, `um5.ac.ma`, `unimelb.edu.au`). Many universities have other domains
 * (`uni-heidelberg.de`, `sorbonne-universite.fr`): those ask, and an admin approves.
 */
export function isAcademicEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return /(^|\.)edu$/.test(domain) || /(^|\.)(ac|edu)\.[a-z]{2}$/.test(domain);
}

export interface EducationRequest {
  id: string;
  name: string;
  email: string;
  school: string;
  requestedAt: string;
}

export class EducationService {
  constructor(
    private db: Db,
    private opts: { cloud: boolean; now?: () => number; /** The checkout has the education discount set up. */ discountActive?: boolean },
  ) {}

  private now() {
    return new Date((this.opts.now ?? Date.now)());
  }

  private requireCloud() {
    if (!this.opts.cloud) throw new ApiError(404, "not_found", "Not found");
  }

  /** Whether an account is a verified education account. Never on a self-hosted server. */
  async isEducation(accountId: string): Promise<boolean> {
    if (!this.opts.cloud) return false;
    const [row] = await this.db.query<{ education_at: Date | null }>("SELECT education_at FROM users WHERE id = $1", [accountId]);
    return !!row?.education_at;
  }

  async status(user: User): Promise<EducationStatus> {
    this.requireCloud();
    const [row] = await this.db.query<{ email: string; email_verified_at: Date | null; education_at: Date | null; education_requested_at: Date | null; education_school: string }>(
      "SELECT email, email_verified_at, education_at, education_requested_at, education_school FROM users WHERE id = $1",
      [user.accountId],
    );
    if (!row) throw new ApiError(404, "user_not_found", "No such account");
    return {
      status: row.education_at ? "verified" : row.education_requested_at ? "requested" : "none",
      school: row.education_school,
      // Recognised by itself only once the address is confirmed: anyone can type one.
      automatic: isAcademicEmail(row.email) && row.email_verified_at !== null,
      owner: user.accountId === user.id,
      freeHours: EDUCATION_FREE_HOURS,
      discountPercent: EDUCATION_DISCOUNT_PERCENT,
      discountActive: !!this.opts.discountActive,
    };
  }

  /** The owner says the account is for a school: verified at once on a confirmed academic address, else it waits for an admin. */
  async request(user: User, school: string): Promise<EducationStatus> {
    this.requireCloud();
    if (user.accountId !== user.id) throw new ApiError(403, "owner_only", "Only the account's owner can ask for this");
    const before = await this.status(user);
    if (before.status !== "verified") {
      await this.db.query(
        before.automatic
          ? "UPDATE users SET education_at = $2, education_requested_at = NULL, education_school = $3 WHERE id = $1"
          : "UPDATE users SET education_requested_at = $2, education_school = $3 WHERE id = $1",
        [user.id, this.now(), school],
      );
    }
    return this.status(user);
  }

  /** Requests waiting for an admin, oldest first. */
  async pending(admin: User): Promise<EducationRequest[]> {
    this.requireCloud();
    if (!admin.isAdmin) throw new ApiError(404, "not_found", "Not found");
    const rows = await this.db.query<{ id: string; name: string; email: string; education_school: string; education_requested_at: Date }>(
      "SELECT id, name, email, education_school, education_requested_at FROM users WHERE education_requested_at IS NOT NULL AND education_at IS NULL ORDER BY education_requested_at",
    );
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, school: r.education_school, requestedAt: r.education_requested_at.toISOString() }));
  }

  /** An admin approves or declines a request, or takes the status away again (approve: false on a verified account). */
  async decide(admin: User, userId: string, approve: boolean): Promise<void> {
    this.requireCloud();
    if (!admin.isAdmin) throw new ApiError(404, "not_found", "Not found");
    const rows = await this.db.query<{ id: string }>(
      "UPDATE users SET education_at = $2, education_requested_at = NULL WHERE id = $1 AND account_id IS NULL RETURNING id",
      [userId, approve ? this.now() : null],
    );
    if (rows.length === 0) throw new ApiError(404, "user_not_found", "No such account");
  }
}
