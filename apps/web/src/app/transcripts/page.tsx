import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { outputUrl } from "@/components/recordings";
import { Icon, PageTitle, type IconName } from "@/components/ui-extra";
import { cn } from "@/components/ui";
import { getServices } from "@/server/context";
import type { TranscriptRow } from "@/server/library";
import { requireUser } from "@/server/page-auth";
import { TranscriptSearch } from "./search";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transcripts" };

const STATE: Record<TranscriptRow["state"], { label: string; icon: IconName; color: string }> = {
  ready: { label: "Ready", icon: "check", color: "text-ok-strong" },
  processing: { label: "Transcribing", icon: "loader", color: "text-warn-strong" },
  queued: { label: "Waiting", icon: "clock", color: "text-warn-strong" },
  failed: { label: "Failed", icon: "alert", color: "text-accent-strong" },
  off: { label: "None", icon: "pause", color: "text-muted" },
};

/** Every transcript the host has, searchable by what was said. Made on this server (whisper.cpp). */
export default async function TranscriptsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const services = await getServices();
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const [studios, model, rows] = await Promise.all([services.studios.list(user), services.library.transcriptsModel(), services.library.transcripts(user, q)]);

  return (
    <DashboardShell user={user} studios={studios} current="transcripts" title="Transcripts">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle>Transcripts</PageTitle>
        <span className={cn("text-[14px]", model?.found === false ? "text-accent-strong" : "text-muted")}>
          {!model
            ? "Transcripts are off on this server (WHISPER_MODEL)"
            : model.found === false
              ? `whisper.cpp · ${model.name} not found on the server, so transcripts fail`
              : `whisper.cpp · ${model.name} · on this server`}
        </span>
      </div>
      <TranscriptSearch initial={q} />

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <span className="mb-1 grid size-11 place-items-center rounded-full bg-surface-2 text-muted">
            <Icon name={q ? "search" : "text"} size={20} />
          </span>
          <span className="font-medium">{q ? `Nothing matches “${q}”` : "No transcripts yet"}</span>
          <span className="text-muted">
            {q
              ? "Only finished transcripts are searched."
              : model
                ? "Each recording is transcribed on this server once its files are ready."
                : "The admin can turn them on with WHISPER_MODEL. Nothing leaves this server."}
          </span>
        </div>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface px-[18px] py-1">
          {rows.map((t) => {
            const s = STATE[t.state];
            return (
              <div
                key={t.recordingId}
                className="grid grid-cols-1 items-center gap-x-4 gap-y-2 border-b border-divider py-3.5 last:border-0 sm:grid-cols-[minmax(0,1fr)_96px_200px]"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <Link href={`/recordings/${t.recordingId}`} className="truncate font-medium text-text hover:text-accent-strong">
                    {t.studioName} · Recording {t.number}
                  </Link>
                  <span className="truncate text-[14px] text-muted">{t.snippet ?? (t.state === "ready" ? "No words" : "—")}</span>
                </span>
                <span className="whitespace-nowrap text-muted">{t.words === null ? "—" : `${t.words.toLocaleString("en-US")} words`}</span>
                <span className="flex items-center justify-between gap-2">
                  <span className={cn("flex items-center gap-[7px] whitespace-nowrap", s.color)}>
                    <Icon name={s.icon} className={t.state === "processing" ? "animate-spin-fast [animation-duration:1.4s]" : undefined} />
                    {s.label}
                  </span>
                  <span className="flex gap-1">
                    {(
                      [
                        ["TXT", t.txt],
                        ["SRT", t.srt],
                      ] as const
                    ).map(([label, id]) =>
                      id ? (
                        <a
                          key={label}
                          href={outputUrl(t.studioId, t.recordingId, id)}
                          aria-label={`Download the ${label} transcript of Recording ${t.number}`}
                          className="rounded-[4px] border border-border bg-surface px-1.5 py-px text-[12px] text-text transition-colors hover:bg-surface-2 hover:text-text"
                        >
                          {label}
                        </a>
                      ) : null,
                    )}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </DashboardShell>
  );
}
