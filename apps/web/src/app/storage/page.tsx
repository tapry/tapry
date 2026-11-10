import { DashboardShell } from "@/components/dashboard-shell";
import { Icon, ListCard, PageTitle } from "@/components/ui-extra";
import { cn } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import { getServices } from "@/server/context";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Storage" };

const BAR_COLORS = ["bg-ink", "bg-muted", "bg-border-strong", "bg-accent", "bg-warn"];

/** Space the host's recordings use; for the admin also whether storage answers and how it's set up. */
export default async function StoragePage() {
  const user = await requireUser();
  const services = await getServices();
  const [studios, s] = await Promise.all([services.studios.list(user), services.library.storageOverview(user)]);
  const total = s.pieces.confirmed + s.pieces.missing;
  const pieces = total === 0 ? "—" : s.pieces.missing === 0 ? "100%" : `${(Math.floor((s.pieces.confirmed / total) * 1000) / 10).toFixed(1)}%`;
  const kept = s.recordings - s.originalsRemoved;
  const stats: Array<{ v: string; k: string; testId?: string; title?: string }> = [
    { v: formatBytes(s.bytes), k: `Used across ${s.studios.length} studio${s.studios.length === 1 ? "" : "s"}`, testId: "storage-total" },
    { v: String(s.recordings), k: "Recordings stored" },
    { v: String(kept), k: s.originalsRemoved > 0 ? `Originals kept · ${s.originalsRemoved} removed` : "Originals kept" },
    { v: pieces, k: "Pieces confirmed", title: `${s.pieces.confirmed.toLocaleString("en-US")} uploaded pieces confirmed in storage, ${s.pieces.missing} never arrived` },
  ];
  const a = s.admin;

  return (
    <DashboardShell user={user} studios={studios} current="storage" title="Storage">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle>Storage</PageTitle>
        {a && (
          <span className={cn("flex items-center gap-[7px] text-[13px]", a.status.ok ? "text-ok-strong" : "text-accent-strong")} title={a.status.summary}>
            <Icon name={a.status.ok ? "check" : "alert"} />
            {a.status.ok ? "Connected" : "Not answering"} · {a.endpointHost}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {stats.map((st) => (
          <div key={st.k} className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-[18px] sm:px-5" title={st.title}>
            <span className="truncate text-[22px] font-medium tracking-[-.02em] tabular-nums" data-testid={st.testId}>
              {st.v}
            </span>
            <span className="text-[13px] text-muted">{st.k}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap justify-between gap-2 text-[13px] text-muted">
          <span>Space used by studio</span>
          <span>{formatBytes(s.bytes)} in total</span>
        </span>
        <div className="flex h-2 overflow-hidden rounded bg-surface-2" aria-hidden>
          {s.studios.map((st, i) => (
            <span key={st.id} className={BAR_COLORS[i % BAR_COLORS.length]} style={{ width: `${s.bytes ? (st.bytes / s.bytes) * 100 : 0}%` }} />
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted">
          {s.studios.map((st, i) => (
            <li key={st.id} className="flex min-w-0 items-center gap-1.5">
              <span className={cn("size-2 shrink-0 rounded-[2px]", BAR_COLORS[i % BAR_COLORS.length])} />
              <span className="truncate">
                {st.name} · {formatBytes(st.bytes)}
              </span>
            </li>
          ))}
          {s.studios.length === 0 && <li>No studios yet</li>}
        </ul>
      </div>

      {a && (
        <ListCard>
          <span className="border-b border-border pt-3 pb-2 text-[13px] text-muted">Configuration</span>
          {(
            [
              ["S3_ENDPOINT", a.endpointHost, "docker-compose.yml"],
              ["S3_BUCKET", a.bucket, "docker-compose.yml"],
              ["S3_ACCESS_KEY_ID", a.accessKey, "docker-compose.yml"],
              [
                "RAW_RETENTION_DAYS",
                a.rawRetentionDays === null ? "Unset: original uploads are kept" : `Original uploads removed ${a.rawRetentionDays} day${a.rawRetentionDays === 1 ? "" : "s"} after processing`,
                "docker-compose.yml",
              ],
              ["UPLOAD_GRACE_DAYS", `${a.uploadGraceDays} days after Stop, late uploads are still taken`, null],
            ] as const
          ).map(([k, v, where]) => (
            <div key={k} className="grid grid-cols-1 items-center gap-x-4 gap-y-1 border-b border-divider py-3 last:border-0 sm:grid-cols-[minmax(140px,max-content)_minmax(0,1fr)_auto]">
              <code className="font-mono text-[13px] [overflow-wrap:anywhere]">{k}</code>
              <span className="truncate text-text-2" title={v}>
                {v}
              </span>
              <span className="text-[13px] whitespace-nowrap text-muted">{where ? `Set in ${where}` : "Built in"}</span>
            </div>
          ))}
        </ListCard>
      )}
    </DashboardShell>
  );
}
