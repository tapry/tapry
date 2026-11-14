import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { Faces } from "@/components/faces";
import { LiveClock } from "@/components/live-clock";
import { shortStatus, STATUS } from "@/components/recordings";
import { OpenStudioAction } from "@/components/studio-actions";
import { Icon, PageTitle } from "@/components/ui-extra";
import { cn } from "@/components/ui";
import { shortClock, shortDate } from "@/lib/format";
import { getServices } from "@/server/context";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recordings" };

/** Every recording across the host's studios, newest first; chips filter by studio or "Processing". */
export default async function RecordingsPage({ searchParams }: { searchParams: Promise<{ studio?: string; filter?: string }> }) {
  const user = await requireUser();
  const services = await getServices();
  const { studio, filter } = await searchParams;
  const studios = await services.studios.list(user);
  const picked = studios.find((s) => s.id === studio);
  const all = await services.processing.listForOwner(user, { studioId: picked?.id, limit: 500 });
  const processing = filter === "processing";
  const recordings = processing ? all.filter((r) => r.status === "stopped" && r.processing !== "ready" && r.processing !== "failed") : all;
  const now = Date.now();

  const chips = [
    { key: "all", label: "All", href: "/recordings", on: !picked && !processing },
    ...studios.map((s) => ({ key: s.id, label: s.name, href: `/recordings?studio=${s.id}`, on: picked?.id === s.id })),
    { key: "processing", label: "Processing", href: "/recordings?filter=processing", on: processing },
  ];

  return (
    <DashboardShell user={user} studios={studios} current="recordings" title="Recordings">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle>Recordings</PageTitle>
        <OpenStudioAction studioId={(picked ?? studios[0])?.id ?? null} label="Open studio" look="dark" />
      </div>
      <nav aria-label="Filter recordings" className="-mt-px flex gap-1 overflow-x-auto border-b border-border pb-3">
        {chips.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            aria-current={c.on ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-md px-[11px] py-[5px] whitespace-nowrap transition-colors focus-visible:-outline-offset-2",
              c.on ? "bg-surface-2 font-medium text-text hover:text-text" : "text-muted hover:text-text",
            )}
          >
            {c.label}
          </Link>
        ))}
      </nav>

      {recordings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <span className="mb-1 grid size-11 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <Icon name="rec" size={20} />
          </span>
          <span className="font-medium">{processing ? "Nothing is processing" : "No recordings yet"}</span>
          <span className="text-muted">
            {processing ? "Every finished recording has its files." : "Open a studio and press Record. Your recordings will appear here."}
          </span>
        </div>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface px-[18px] py-1">
          {recordings.map((r) => {
            const st = shortStatus(r);
            const s = STATUS[st.tone];
            const live = st.tone === "live";
            const length = live ? <LiveClock startedAt={r.startedAt} serverNow={now} /> : shortClock((r.stoppedAt ?? r.startedAt) - r.startedAt);
            const date = shortDate(r.startedAt, now);
            return (
              <Link
                key={r.id}
                href={live ? `/studios/${r.studioId}` : `/recordings/${r.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 rounded-xl border-b border-divider py-3.5 text-text transition-colors duration-200 last:border-0 hover:bg-canvas hover:text-text sm:grid-cols-[minmax(0,3fr)_auto_auto_auto]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Faces names={r.people.map((p) => p.name)} className="w-[62px]" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">Recording {r.number}</span>
                    <span className="truncate text-[14px] text-muted">
                      {r.studioName}
                      <span className="sm:hidden">
                        {" "}
                        · {date} · {length}
                      </span>
                    </span>
                  </span>
                </span>
                <span className="hidden whitespace-nowrap text-muted sm:inline">{date}</span>
                <span className="hidden whitespace-nowrap text-muted tabular-nums sm:inline">{length}</span>
                <span className={cn("flex items-center gap-[7px] whitespace-nowrap", s.color)}>
                  <Icon name={s.icon} className={live ? s.anim : undefined} />
                  {st.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </DashboardShell>
  );
}
