import { recordingLabel } from "@/components/quality-options";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { Faces } from "@/components/faces";
import { OpenStudioAction } from "@/components/studio-actions";
import { Icon, PageTitle } from "@/components/ui-extra";
import { cn } from "@/components/ui";
import { formatBytes, shortDate } from "@/lib/format";
import { getServices } from "@/server/context";
import { requireUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studios" };

// The designs' tile colours, in turn: dark, light grey, terracotta.
const TILES = ["bg-ink text-ink-text", "bg-border-strong text-text", "bg-accent text-accent-text"];

/** Every studio as a card (the design's "Shows"): its numbers, who recorded lately, Record. */
export default async function StudiosPage() {
  const user = await requireUser();
  const services = await getServices();
  const [studios, cards] = await Promise.all([services.studios.list(user), services.library.studioCards(user)]);
  const bucket = services.library.bucketFor(user);
  const now = Date.now();

  return (
    <DashboardShell user={user} studios={studios} current="studios" title="Studios">
      <div className="flex flex-col gap-[22px]">
        <div className="flex flex-wrap items-end justify-between gap-3.5">
          <div className="flex flex-col gap-1">
            <PageTitle strong>Studios</PageTitle>
            <span className="text-muted">Each studio keeps its own recordings, guest link and settings.</span>
          </div>
          <Link
            href="/studios/new"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-ink px-3.5 text-sm font-medium whitespace-nowrap text-ink-text transition-colors hover:bg-ink-hover hover:text-ink-text"
          >
            <Icon name="plus" size={15} />
            New studio
          </Link>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-4">
          {cards.map((s, i) => (
            <div key={s.id} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-[18px]">
              <span className="flex items-center justify-between gap-2.5">
                <span className="flex min-w-0 items-center gap-[11px]">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-[9px]", TILES[i % TILES.length])}>
                    <Icon name={s.live ? "rec" : "studios"} size={17} className={s.live ? "animate-rec-pulse" : undefined} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <Link href={`/studios/${s.id}`} data-testid="studio-link" className="truncate text-base font-medium text-text hover:text-accent-strong">
                      {s.name}
                    </Link>
                    <span className="text-[13px] text-muted">
                      {s.live ? (
                        <span className="text-accent-strong">Recording now</span>
                      ) : (
                        <>
                          {recordingLabel(s.settings)} · up to {s.settings.maxGuests}{" "}
                          guest{s.settings.maxGuests === 1 ? "" : "s"}
                        </>
                      )}
                    </span>
                  </span>
                </span>
                <Faces names={s.people} className="[&>span]:-ml-[7px]" />
              </span>
              <span className="grid grid-cols-3 gap-2">
                <Tile value={String(s.recordings)} label={s.recordings === 1 ? "recording" : "recordings"} />
                <Tile value={(s.recordedMs / 3_600_000).toFixed(1)} label="hours" />
                <Tile value={formatBytes(s.bytes)} label="stored" />
              </span>
              <span className="flex flex-col gap-2 text-[13.5px] text-text-2">
                <span className="flex items-center gap-2">
                  <Icon name="clock" size={15} className="text-muted" />
                  {s.lastRecordingAt ? `Last recording: ${shortDate(s.lastRecordingAt, now)}` : "No recordings yet"}
                </span>
                {bucket && (
                  <span className="flex min-w-0 items-center gap-2" title="Every studio's files are in this bucket (shown to admins)">
                    <Icon name="storage" size={15} className="text-muted" />
                    <span className="truncate">s3://{bucket}</span>
                  </span>
                )}
              </span>
              <span className="flex gap-2 border-t border-divider pt-3.5">
                <OpenStudioAction studioId={s.id} label={s.live ? "Back to the studio" : "Record"} look="record" />
                <Link
                  href={`/recordings?studio=${s.id}`}
                  className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-border bg-surface px-3.5 text-sm font-medium whitespace-nowrap text-text shadow-xs transition-colors hover:bg-surface-2 hover:text-text"
                >
                  Recordings
                </Link>
              </span>
            </div>
          ))}
          <Link
            href="/studios/new"
            className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-muted transition-colors hover:border-ink hover:text-text"
          >
            <Icon name="plus" size={20} />
            New studio
          </Link>
        </div>
      </div>
    </DashboardShell>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-surface-2 px-[11px] py-[9px]">
      <span className="truncate text-[17px] font-medium whitespace-nowrap tabular-nums">{value}</span>
      <span className="text-[12.5px] text-muted">{label}</span>
    </span>
  );
}
