import { DashboardShell } from "@/components/dashboard-shell";
import { Icon, PageTitle } from "@/components/ui-extra";
import { getServices } from "@/server/context";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usage" };

/** "3 h 20 min", "45 min", "0 min": recorded time as a figure. */
function hours(ms: number) {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function monthName(key: string, long = false) {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: long ? "long" : "short", year: long ? "numeric" : undefined, timeZone: "UTC" });
}

/** What the account has recorded: totals, and the last twelve months side by side. */
export default async function UsagePage() {
  const user = await requireUser();
  const services = await getServices();
  const [studios, u] = await Promise.all([services.studios.list(user), services.library.usage(user)]);
  const stats = [
    { v: String(u.recordings), k: u.recordings === 1 ? "Recording" : "Recordings", testId: "usage-recordings" },
    { v: hours(u.recordedMs), k: "Recorded", testId: "usage-recorded" },
    { v: String(u.guests), k: u.guests === 1 ? "Guest" : "Guests", testId: "usage-guests" },
    { v: String(u.transcripts), k: u.transcripts === 1 ? "Transcript" : "Transcripts" },
  ];
  const peak = Math.max(...u.months.map((m) => m.recordedMs));

  return (
    <DashboardShell user={user} studios={studios} current="usage" title="Usage">
      <PageTitle>Usage</PageTitle>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {stats.map((st) => (
          <div key={st.k} className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-[18px] sm:px-5">
            <span className="truncate text-[22px] font-medium tracking-[-.02em] tabular-nums" data-testid={st.testId}>
              {st.v}
            </span>
            <span className="text-[13px] text-muted">{st.k}</span>
          </div>
        ))}
      </div>

      {u.recordings === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <span className="mb-1 grid size-11 place-items-center rounded-full bg-surface-2 text-muted">
            <Icon name="gauge" size={20} />
          </span>
          <span className="font-medium">Nothing recorded yet</span>
          <span className="text-muted">Your recordings, hours and guests are counted here.</span>
        </div>
      ) : (
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface px-[18px] py-4" aria-labelledby="by-month">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="by-month" className="font-medium">
              Recorded each month
            </h2>
            <span className="text-[13px] text-muted">Last 12 months</span>
          </div>
          {/* The bars are the picture; the table under them is the same figures for everyone. */}
          <div className="flex h-36 items-end gap-1.5 sm:gap-2.5" aria-hidden>
            {u.months.map((m) => (
              <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5" title={`${monthName(m.month, true)}: ${hours(m.recordedMs)}`}>
                <span className="rounded-t-[3px] bg-ink" style={{ height: `${peak > 0 ? Math.max(m.recordedMs > 0 ? 3 : 0, (m.recordedMs / peak) * 100) : 0}%` }} />
                <span className="truncate text-center text-[11px] text-muted">{monthName(m.month)}</span>
              </div>
            ))}
          </div>
          <table className="w-full text-left text-[13px] tabular-nums" data-testid="usage-months">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th className="py-2 font-normal">Month</th>
                <th className="py-2 font-normal">Recordings</th>
                <th className="py-2 font-normal">Recorded</th>
                <th className="py-2 font-normal">Guests</th>
              </tr>
            </thead>
            <tbody>
              {u.months
                .filter((m) => m.recordings > 0)
                .reverse()
                .map((m) => (
                  <tr key={m.month} className="border-b border-border last:border-0">
                    <td className="py-2">{monthName(m.month, true)}</td>
                    <td className="py-2">{m.recordings}</td>
                    <td className="py-2">{hours(m.recordedMs)}</td>
                    <td className="py-2">{m.guests}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="text-[13px] text-muted">Recordings you have deleted are not counted. Months follow UTC.</p>
        </section>
      )}
    </DashboardShell>
  );
}
