import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { RecordingFilters } from "@/components/recording-filters";
import { RecordingTimeline } from "@/components/recording-timeline";
import { describeOutput, outputUrl, phase, shortStatus } from "@/components/recordings";
import { Icon, PageTitle, Spinner } from "@/components/ui-extra";
import { Avatar, cn } from "@/components/ui";
import { formatBytes, shortClock } from "@/lib/format";
import { getServices } from "@/server/context";
import { isApiError } from "@/server/errors";
import { requireUser } from "@/server/page-auth";
import { RecordingPlayer } from "./player";

export const dynamic = "force-dynamic";

async function load(recordingId: string) {
  const user = await requireUser();
  const services = await getServices();
  const recording = await services.processing.getForOwner(user, recordingId).catch((err) => {
    if (isApiError(err) && err.status === 404) notFound();
    throw err;
  });
  return { user, services, recording };
}

export async function generateMetadata({ params }: { params: Promise<{ recordingId: string }> }) {
  const { recording } = await load((await params).recordingId);
  return { title: `Recording ${recording.number} · ${recording.studioName}` };
}

const PILL = {
  ok: "bg-ok-soft text-ok-strong",
  warn: "bg-warn-soft text-warn-strong",
  danger: "bg-accent-soft text-accent-strong",
  live: "bg-accent-soft text-accent-strong",
} as const;

/** One recording (the design's "Episode"): its sound, its files and what was said. */
export default async function RecordingPage({ params }: { params: Promise<{ recordingId: string }> }) {
  const { user, services, recording: r } = await load((await params).recordingId);
  const [studios, transcript, model] = await Promise.all([
    services.studios.list(user),
    services.library.transcriptTurns(user, r.id),
    services.library.transcriptsModel(),
  ]);
  const studio = studios.find((s) => s.id === r.studioId);
  const now = Date.now();
  const st = shortStatus(r);
  const ready = r.processing === "ready";
  const media = r.outputs.filter((o) => o.kind !== "transcript");
  const transcriptFiles = r.outputs.filter((o) => o.kind === "transcript");
  const sound = r.outputs.find((o) => o.kind === "combined") ?? r.outputs.find((o) => o.kind === "audio");
  const lengthMs = (r.stoppedAt ?? now) - r.startedAt;
  const txt = transcriptFiles.find((o) => o.fileName.endsWith(".txt"));
  const srt = transcriptFiles.find((o) => o.fileName.endsWith(".srt"));
  const people = r.people.length;

  return (
    <DashboardShell user={user} studios={studios} current="recordings" currentId={r.studioId} currentRecordingId={r.id} title={`Recording ${r.number}`}>
      <div className="flex flex-col gap-5">
        <Link href="/recordings" className="flex items-center gap-1.5 self-start text-muted hover:text-text">
          <Icon name="back" size={15} />
          Recordings
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-3.5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <PageTitle strong>Recording {r.number}</PageTitle>
            <span className="flex flex-wrap items-center gap-2 text-muted">
              <Link href={`/studios/${r.studioId}`} className="text-muted hover:text-text">
                {r.studioName}
              </Link>
              · {people} {people === 1 ? "person" : "people"} · {shortClock(lengthMs)}
              <span className={cn("flex items-center gap-[5px] rounded-md px-2 py-0.5 text-[12.5px] font-medium", PILL[st.tone])}>
                <Icon name={st.tone === "ok" ? "check" : st.tone === "live" ? "rec" : st.tone === "danger" ? "alert" : "loader"} size={13} className={st.tone === "live" ? "animate-rec-pulse" : undefined} />
                {ready ? "Ready" : phase(r).label}
              </span>
            </span>
          </div>
          {ready && r.outputs.length > 0 && (
            <a
              href={`/api/studios/${r.studioId}/recordings/${r.id}/zip`}
              className="inline-flex h-[34px] items-center gap-[7px] rounded-md border border-ink bg-ink px-3 text-sm font-medium whitespace-nowrap text-ink-text transition-colors hover:bg-ink-hover hover:text-ink-text"
            >
              <Icon name="download" size={15} />
              Download all · {formatBytes(r.outputs.reduce((n, o) => n + o.bytes, 0))}
            </a>
          )}
        </div>

        {ready && sound ? (
          <RecordingPlayer src={outputUrl(r.studioId, r.id, sound.id)} bytes={sound.bytes} lengthMs={sound.durationMs ?? lengthMs} />
        ) : (
          <div className="flex flex-col gap-3">
            <RecordingTimeline recording={r} now={now} levelLoudness={studio?.settings.levelLoudness ?? true} />
            {(r.processing === "failed" || (r.status === "stopped" && r.processing === "pending" && r.incompleteTracks > 0)) && (
              <p className="text-[13.5px] text-muted">
                {r.processing === "failed" ? (r.processingError ?? "The files couldn't be made. The uploads are safe.") : "Someone's recording is still on its way."}{" "}
                <Link href={`/studios/${r.studioId}`} className="font-medium text-text underline underline-offset-[3px] hover:text-accent-strong">
                  Open the studio
                </Link>{" "}
                to try again or finish without them.
              </p>
            )}
          </div>
        )}
        {ready && r.skippedTracks.length > 0 && (
          <p className="rounded-lg bg-warn-soft px-3.5 py-3 text-sm text-warn-strong">
            We couldn&apos;t read {r.skippedTracks.map((t) => `${t.name}'s ${t.kind}`).join(", ")}, so it&apos;s missing from these files. The upload is kept:{" "}
            <Link href={`/studios/${r.studioId}`} className="font-medium underline underline-offset-[3px]">
              try again from the studio
            </Link>
            .
          </p>
        )}
        {ready && r.hasFilters && <RecordingFilters studioId={r.studioId} recordingId={r.id} applyFilters={r.applyFilters} filtersFailed={r.filtersFailed} rawDeleted={r.rawDeleted} />}
        {r.keepUntil !== null && (
          <p className="text-[13px] text-muted" data-testid="kept-until">
            Kept until {new Date(r.keepUntil).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} on your plan, then deleted. Download what you want to keep.
          </p>
        )}
        {r.rawDeleted && (
          <p className="text-[13px] text-muted">The original uploads were removed after this server&apos;s retention period. These files are what&apos;s kept.</p>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-start gap-4">
          <div className="flex flex-col rounded-xl border border-border bg-surface px-[18px] py-1">
            <span className="pt-3 pb-2 font-medium">Files</span>
            {media.length === 0 ? (
              <span className="border-t border-divider py-3 text-[13.5px] text-muted">{ready ? "No files." : "The files appear here once they're ready."}</span>
            ) : (
              media.map((o) => {
                const d = describeOutput(o);
                return (
                  <span key={o.id} className="flex items-center justify-between gap-3 border-t border-divider py-2.5">
                    <span className="flex min-w-0 flex-col gap-px">
                      <span className="truncate" title={o.fileName}>
                        {d.title}
                      </span>
                      <span className="text-[12.5px] text-muted">
                        {d.format} · {formatBytes(o.bytes)}
                      </span>
                    </span>
                    <a
                      href={outputUrl(r.studioId, r.id, o.id)}
                      data-file-name={o.fileName}
                      aria-label={`Download ${d.title}`}
                      title="Download"
                      className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 hover:text-text"
                    >
                      <Icon name="download" size={15} />
                    </a>
                  </span>
                );
              })
            )}
          </div>

          <div className="flex flex-col rounded-xl border border-border bg-surface px-[18px] pt-1 pb-3.5">
            <span className="flex items-center justify-between gap-2 pt-3 pb-2 font-medium">
              Transcript
              <span className="flex gap-[5px]">
                {[txt, srt].map((o) =>
                  o ? (
                    <a
                      key={o.id}
                      href={outputUrl(r.studioId, r.id, o.id)}
                      data-file-name={o.fileName}
                      className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-normal text-text transition-colors hover:bg-surface-2 hover:text-text"
                    >
                      {o.fileName.split(".").pop()!.toUpperCase()}
                    </a>
                  ) : null,
                )}
              </span>
            </span>
            <TranscriptBody state={transcript.state} turns={transcript.turns} ready={ready} on={model !== null} />
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

function TranscriptBody({ state, turns, ready, on }: { state: string; turns: Array<{ speaker: string; startMs: number; text: string }> | null; ready: boolean; on: boolean }) {
  const note = (text: string, busy = false) => (
    <span className="flex items-center gap-2 border-t border-divider pt-3 text-[13.5px] text-muted">
      {busy && <Spinner size={14} />}
      {text}
    </span>
  );
  if (turns && turns.length > 0) {
    return (
      <div className="flex max-h-[560px] flex-col overflow-y-auto">
        {turns.map((l, i) => (
          <div key={`${l.startMs}-${i}`} className="flex gap-2.5 border-t border-divider py-2.5">
            <Avatar name={l.speaker || "?"} className="size-6 text-[9px]" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px]">
                <span className="font-medium">{l.speaker || "Someone"}</span> <span className="text-muted tabular-nums">{shortClock(l.startMs)}</span>
              </span>
              <span className="leading-normal text-pretty text-text-2">{l.text}</span>
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (turns) return note("Nobody was heard in this recording.");
  if (state === "queued" || state === "processing") return note("Writing the transcript on this server. It appears here when it's done.", true);
  if (state === "failed") return note("The transcript couldn't be made. The audio and video files are fine.");
  if (state === "ready") return note("Couldn't read the transcript just now. The files above still download.");
  if (!on) return note("Transcripts are off on this server (the admin turns them on with WHISPER_MODEL).");
  if (!ready) return note("The transcript is written once the files are ready.");
  return note("No transcript for this recording: it was made before transcripts were on.");
}
