import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { cn } from "@/components/ui";
import { Icon, ListCard, type IconName } from "@/components/ui-extra";
import { formatBytes, formatWhen } from "@/lib/format";
import { getServices } from "@/server/context";
import type { Tone } from "@/server/health";
import { requireUser } from "@/server/page-auth";
import { CallProbe, CheckAgain } from "./check-again";

export const dynamic = "force-dynamic";
export const metadata = { title: "Server health" };

const ICON: Record<Tone, IconName> = { ok: "check", warn: "alert", danger: "alert", off: "pause" };
const COLOR: Record<Tone, string> = {
  ok: "text-ok-strong",
  warn: "text-warn-strong",
  danger: "text-accent-strong",
  off: "text-subtle",
};

/** For the admin: is everything this install needs working, and if not, what to look at. */
export default async function HealthPage() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  const services = await getServices();
  const [studios, report] = await Promise.all([services.studios.list(user), services.health.report()]);
  const problems = report.checks.filter((c) => c.tone === "danger").length;
  const warnings = report.checks.filter((c) => c.tone === "warn").length;

  return (
    <DashboardShell user={user} studios={studios} title="Server health" current="health">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[27px] leading-tight font-medium tracking-[-.02em]">Server health</h1>
          <p
            className={cn("flex items-center gap-[7px] text-[14px]", problems ? "text-accent-strong" : warnings ? "text-warn-strong" : "text-ok-strong")}
            data-testid="health-summary"
          >
            <Icon name={problems || warnings ? "alert" : "check"} />
            <span>
              {problems ? `${problems} problem${problems === 1 ? "" : "s"} need${problems === 1 ? "s" : ""} attention` : warnings ? "Working, with warnings" : "Everything is working"}
              <span className="text-muted">
                {" "}
                · version {report.version} · checked {formatWhen(report.checkedAt, report.checkedAt)}
              </span>
            </span>
          </p>
        </div>
        <CheckAgain />
      </div>

      <ListCard>
        <span className="border-b border-border pt-3 pb-2 text-[14px] text-muted">Checks</span>
        <ul aria-label="Checks" className="flex flex-col">
          {report.checks.map((c) => (
            <li
              key={c.id}
              className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3 border-b border-divider py-3.5 last:border-0"
              data-check={c.id}
              data-tone={c.tone}
            >
              <Icon name={ICON[c.tone]} className={cn("mt-px", COLOR[c.tone])} />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-medium">{c.label}</span>
                  <span className={cn(c.tone === "danger" ? "text-accent-strong" : c.tone === "warn" ? "text-warn-strong" : "text-text-2")}>{c.summary}</span>
                </span>
                {c.details.map((d) => (
                  <span key={d} className="text-[14px] break-words text-muted">
                    {d}
                  </span>
                ))}
                {c.id === "call" && report.callUrl && <CallProbe url={report.callUrl} />}
              </span>
            </li>
          ))}
        </ul>
      </ListCard>

      {report.workers.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="font-medium">Workers</h2>
          <ListCard>
            <ul className="flex flex-col">
              {report.workers.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-divider py-3 last:border-0"
                  data-testid="worker"
                >
                  <span className="font-medium">{w.kind === "inprocess" ? "Inside the web server" : `Worker …${w.id.slice(-6)}`}</span>
                  <span className="text-[14px] text-muted">version {w.version}</span>
                  <span className="text-[14px] text-muted">seen {formatWhen(w.seenAt, report.checkedAt)}</span>
                  {w.info.tmpFreeBytes !== null && <span className="text-[14px] text-muted">{formatBytes(w.info.tmpFreeBytes)} free</span>}
                  <span className="text-[14px] text-muted">transcripts {w.info.whisper ? (w.info.whisper.modelFound ? "on" : "model missing") : "off"}</span>
                </li>
              ))}
            </ul>
          </ListCard>
        </section>
      )}

      {report.failures.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="font-medium">Failed jobs in the last 7 days</h2>
          <ListCard>
            <ul className="flex flex-col">
              {report.failures.map((f) => (
                <li key={`${f.recordingId}-${f.at}`} className="flex flex-col gap-1 border-b border-divider py-3 last:border-0" data-testid="failed-job">
                  <span>
                    <span className="font-medium">{f.type === "transcribe_recording" ? "Transcript" : "Processing"}</span>
                    <span className="text-muted"> · {formatWhen(f.at, report.checkedAt)} · recording {f.recordingId}</span>
                  </span>
                  {f.error && <code className="font-mono text-xs break-words text-muted">{f.error}</code>}
                </li>
              ))}
            </ul>
          </ListCard>
        </section>
      )}
    </DashboardShell>
  );
}
