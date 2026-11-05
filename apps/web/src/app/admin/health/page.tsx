import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, cn } from "@/components/ui";
import { formatBytes, formatWhen } from "@/lib/format";
import { getServices } from "@/server/context";
import type { Tone } from "@/server/health";
import { requireUser } from "@/server/page-auth";
import { CallProbe, CheckAgain } from "./check-again";

export const dynamic = "force-dynamic";
export const metadata = { title: "Server health" };

const ICON: Record<Tone, string> = { ok: "✓", warn: "!", danger: "!", off: "–" };
const DOT: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok-strong",
  warn: "bg-warn-soft text-warn-strong",
  danger: "bg-accent-soft text-accent-strong",
  off: "bg-surface-2 text-muted",
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
    <DashboardShell user={user} studios={studios} title="Server health">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[clamp(28px,3.2vw,38px)] leading-[1.08] font-semibold tracking-[-.02em]">Server health</h1>
          <p className="text-[15px] text-muted" data-testid="health-summary">
            {problems ? `${problems} problem${problems === 1 ? "" : "s"} need${problems === 1 ? "s" : ""} attention` : warnings ? "Working, with warnings" : "Everything is working"} ·
            version {report.version} · checked {formatWhen(report.checkedAt, report.checkedAt)}
          </p>
        </div>
        <CheckAgain />
      </div>

      <Card className="p-0">
        <ul className="divide-y divide-border" aria-label="Checks">
          {report.checks.map((c) => (
            <li key={c.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3.5 px-6 py-4" data-check={c.id} data-tone={c.tone}>
              <span aria-hidden className={cn("mt-px grid size-7 place-items-center rounded-full text-[13px] font-semibold", DOT[c.tone])}>
                {ICON[c.tone]}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-[15px] font-semibold">{c.label}</span>
                  <span className={cn("text-[15px]", c.tone === "danger" ? "text-accent-strong" : c.tone === "warn" ? "text-warn-strong" : "text-text-2")}>
                    {c.summary}
                  </span>
                </span>
                {c.details.map((d) => (
                  <span key={d} className="text-sm break-words text-muted">
                    {d}
                  </span>
                ))}
                {c.id === "call" && report.callUrl && <CallProbe url={report.callUrl} />}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {report.workers.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-[19px] font-semibold">Workers</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {report.workers.map((w) => (
              <li key={w.id} className="flex flex-wrap gap-x-4 gap-y-1" data-testid="worker">
                <span className="font-medium">{w.kind === "inprocess" ? "Inside the web server" : `Worker …${w.id.slice(-6)}`}</span>
                <span className="text-muted">version {w.version}</span>
                <span className="text-muted">seen {formatWhen(w.seenAt, report.checkedAt)}</span>
                {w.info.tmpFreeBytes !== null && <span className="text-muted">{formatBytes(w.info.tmpFreeBytes)} free</span>}
                <span className="text-muted">transcripts {w.info.whisper ? (w.info.whisper.modelFound ? "on" : "model missing") : "off"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {report.failures.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-[19px] font-semibold">Failed jobs in the last 7 days</h2>
          <ul className="flex flex-col gap-3 text-sm">
            {report.failures.map((f) => (
              <li key={`${f.recordingId}-${f.at}`} className="flex flex-col gap-0.5" data-testid="failed-job">
                <span>
                  <span className="font-medium">{f.type === "transcribe_recording" ? "Transcript" : "Processing"}</span>
                  <span className="text-muted"> · {formatWhen(f.at, report.checkedAt)} · recording {f.recordingId}</span>
                </span>
                {f.error && <code className="font-mono text-[12px] break-words text-muted">{f.error}</code>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </DashboardShell>
  );
}
