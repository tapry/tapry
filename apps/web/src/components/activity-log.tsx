// Settings → Members, for the account's owner: who changed or took what, and when. Names of
// things only, kept for a year.
import type { Activity } from "@/server/collab";
import { ListCard } from "./ui-extra";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export function ActivityLog({ entries }: { entries: Activity[] }) {
  return (
    <ListCard data-testid="activity">
      <span className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border pt-3 pb-2 text-[14px] text-muted">
        <span>Activity in this account: changes and downloads, newest first, kept for a year. Times are UTC. Only you, the owner, see this.</span>
        {entries.length > 0 && (
          <a href="/api/activity?format=csv" download className="shrink-0 font-medium text-text underline underline-offset-2" data-testid="activity-csv">
            Download as CSV
          </a>
        )}
      </span>
      {entries.length === 0 ? (
        <span className="py-3 text-[14.5px] text-muted">Nothing yet.</span>
      ) : (
        <div className="flex max-h-[420px] flex-col overflow-y-auto">
          {entries.map((e, i) => (
            <span key={e.id} className={`flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 py-2.5 text-[14.5px] ${i < entries.length - 1 ? "border-b border-divider" : ""}`} data-testid="activity-entry">
              <span className="min-w-0">
                <span className="font-medium">{e.who}</span> <span className="text-text-2">{e.action.charAt(0).toLowerCase() + e.action.slice(1)}</span>
                {e.target && <span className="text-muted"> · {e.target}</span>}
              </span>
              <span className="shrink-0 text-[13.5px] text-muted tabular-nums">{when(e.at)}</span>
            </span>
          ))}
        </div>
      )}
    </ListCard>
  );
}
