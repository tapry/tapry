// The Tapry Cloud waitlist: people who asked on the website to hear when paid plans open.
// Only on Tapry Cloud (a self-hosted server answers 404). An address is personal data: it is
// never logged, the admin can remove it, and the answer is the same whether or not it was
// already on the list.
import type { User } from "./auth";
import type { Db } from "./db";
import { ApiError } from "./errors";

/** Sign-ups to the list one address may send per hour. */
export const WAITLIST_PER_ADDRESS = 5;
/** The list stops growing here, so nobody can fill the database through a public form. */
export const WAITLIST_MAX = 50_000;

export interface WaitlistEntry {
  email: string;
  plan: string | null;
  createdAt: string;
}

export class WaitlistService {
  private recent = new Map<string, number[]>();

  constructor(
    private db: Db,
    private opts: { cloud: boolean; now?: () => number },
  ) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private requireCloud() {
    if (!this.opts.cloud) throw new ApiError(404, "not_found", "Not found");
  }

  async join(email: string, plan: string | undefined, address: string) {
    this.requireCloud();
    const since = this.now() - 60 * 60 * 1000;
    const recent = (this.recent.get(address) ?? []).filter((t) => t > since);
    if (recent.length >= WAITLIST_PER_ADDRESS) throw new ApiError(429, "slow_down", "Too many requests from your address. Try again in an hour.");
    this.recent.set(address, [...recent, this.now()]);
    for (const [key, times] of this.recent) if (times.every((t) => t <= since)) this.recent.delete(key);

    const [{ count }] = (await this.db.query<{ count: number }>("SELECT count(*)::int AS count FROM waitlist")) as [{ count: number }];
    if (count >= WAITLIST_MAX) throw new ApiError(503, "unavailable", "The list can't take more addresses right now.");
    // Asking again keeps the first date and takes the newer plan, if one was named.
    await this.db.query(
      `INSERT INTO waitlist (email, plan, created_at) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET plan = COALESCE(EXCLUDED.plan, waitlist.plan)`,
      [email, plan ?? null, new Date(this.now())],
    );
  }

  async list(admin: User): Promise<WaitlistEntry[]> {
    this.requireAdmin(admin);
    const rows = await this.db.query<{ email: string; plan: string | null; created_at: Date }>("SELECT email, plan, created_at FROM waitlist ORDER BY created_at DESC, email");
    return rows.map((r) => ({ email: r.email, plan: r.plan, createdAt: new Date(r.created_at).toISOString() }));
  }

  async remove(admin: User, email: string) {
    this.requireAdmin(admin);
    await this.db.query("DELETE FROM waitlist WHERE email = $1", [email]);
  }

  private requireAdmin(user: User) {
    this.requireCloud();
    if (!user.isAdmin) throw new ApiError(404, "not_found", "Not found");
  }
}
