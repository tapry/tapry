import { GuestNote } from "@/components/guest-note";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { CopyGuestLink } from "@/components/studio-actions";
import { Icon, PageTitle, type IconName } from "@/components/ui-extra";
import { Avatar, cn } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { getServices } from "@/server/context";
import type { GuestRow } from "@/server/library";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Guests" };

const COLS = "sm:grid-cols-[minmax(0,1.6fr)_minmax(0,.6fr)_minmax(0,.8fr)_minmax(0,1.3fr)]";

function check(g: GuestRow, now: number): { icon: IconName; color: string; label: string } {
  const c = g.techCheck;
  if (!c) return { icon: "clock", color: "text-muted", label: "—" };
  if (c.issues.length === 0) return { icon: "shield", color: "text-ok-strong", label: `Passed ${shortDate(c.at, now)}` };
  const worst = c.issues.find((i) => i.tone === "danger") ?? c.issues[0]!;
  const more = c.issues.length - 1;
  return { icon: "alert", color: worst.tone === "danger" ? "text-accent-strong" : "text-warn-strong", label: `${worst.label}${more > 0 ? ` (+${more} more)` : ""}` };
}

/** Everyone who recorded with the host as a guest: how often, when last, and their tech check. */
export default async function GuestsPage() {
  const user = await requireUser();
  const services = await getServices();
  const [studios, guests] = await Promise.all([services.studios.list(user), services.library.guests(user)]);
  const newest = studios[0];
  const now = Date.now();

  return (
    <DashboardShell user={user} studios={studios} current="guests" title="Guests">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle>Guests</PageTitle>
        {newest ? (
          <CopyGuestLink inviteCode={newest.inviteCode} studioName={newest.name} look="dark" label="Invite a guest" />
        ) : (
          <Link href="/studios/new" className="inline-flex h-[34px] items-center rounded-md bg-ink px-3.5 text-sm font-medium text-ink-text hover:bg-ink-hover hover:text-ink-text">
            New studio
          </Link>
        )}
      </div>

      {guests.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <span className="mb-1 grid size-11 place-items-center rounded-full bg-surface-2 text-muted">
            <Icon name="guests" size={20} />
          </span>
          <span className="font-medium">No guests yet</span>
          <span className="text-muted">Guests appear here once they&apos;ve recorded with you.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface px-[18px] py-1">
            <div className={cn("hidden gap-4 border-b border-border py-2.5 text-[14px] text-muted sm:grid", COLS)}>
              <span>Guest</span>
              <span>Recordings</span>
              <span>Last joined</span>
              <span>Tech check</span>
            </div>
            {guests.map((g) => {
              const c = check(g, now);
              return (
                <div key={g.name} className={cn("grid grid-cols-1 items-center gap-x-4 gap-y-1.5 border-b border-divider py-3 last:border-0", COLS)}>
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={g.name} className="size-7 text-[12px]" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{g.name}</span>
                      <span className="truncate text-[14px] text-muted">{g.studios.map((s) => s.name).join(", ")}</span>
                    </span>
                  </span>
                  <span className="text-muted">
                    {g.recordings}
                    <span className="sm:hidden"> recording{g.recordings === 1 ? "" : "s"} · last joined {shortDate(g.lastJoinedAt, now)}</span>
                  </span>
                  <span className="hidden text-muted sm:inline">{shortDate(g.lastJoinedAt, now)}</span>
                  <span className={cn("flex min-w-0 items-center gap-[7px]", c.color)}>
                    <Icon name={c.icon} />
                    <span className="truncate" title={c.label}>
                      <span className="sm:hidden">Tech check: </span>
                      {c.label}
                    </span>
                  </span>
                  <GuestNote name={g.name} initial={{ email: g.email, notes: g.notes }} canEdit={!user.viewer} />
                </div>
              );
            })}
          </div>
          <p className="text-[14px] text-muted">
            Contact details and notes are yours: guests never see them. Tech check: the newest one sent under the same name in that studio, from the last 30 days. Guests have no account, so names are how
            they&apos;re matched.
          </p>
        </div>
      )}
    </DashboardShell>
  );
}
