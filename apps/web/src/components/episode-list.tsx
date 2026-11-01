"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { formatBytes, formatClock, formatDuration, formatWhen } from "@/lib/format";
import type { RecordingSummary } from "@/server/processing";
import { ConfirmAction } from "./confirm-action";
import { Button, Card, cn, Notice, StatusDot, StatusPill } from "./ui";

type Episode = RecordingSummary;

/** Nothing more will change without someone acting: no polling needed. */
export const settled = (e: Episode) =>
  (e.processing === "ready" || e.processing === "failed") && e.transcript !== "queued" && e.transcript !== "processing";

function phase(e: Episode) {
  if (e.status === "recording") return { tone: "live", label: "Recording now" } as const;
  if (e.processing === "ready") return { tone: "ok", label: "Ready to download" } as const;
  if (e.processing === "failed") return { tone: "danger", label: "Something went wrong" } as const;
  if (e.processing === "queued" || e.processing === "processing") return { tone: "warn", label: "Getting files ready…" } as const;
  return { tone: "warn", label: e.incompleteTracks ? "Waiting for a guest" : "Finishing uploads" } as const;
}

/** A show's episodes, newest first. The newest is open; click a row to open or close it. */
export function EpisodeList({
  showId,
  episodes,
  now,
  levelLoudness,
  onChange,
}: {
  showId: string;
  episodes: Episode[];
  now: number;
  levelLoudness: boolean;
  onChange: (update: (list: Episode[]) => Episode[]) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(episodes[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  async function processNow(e: Episode) {
    setError(null);
    try {
      await apiFetch(`/studios/${showId}/recordings/${e.id}/process`, { body: {} });
      onChange((list) => list.map((x) => (x.id === e.id ? { ...x, processing: "queued" } : x)));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't start processing.");
    }
  }

  async function remove(e: Episode) {
    await apiFetch(`/studios/${showId}/recordings/${e.id}`, { method: "DELETE" });
    onChange((list) => list.filter((x) => x.id !== e.id));
    router.refresh(); // the show's space used and the sidebar
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-6 py-5">
        <h2 className="text-[19px] font-semibold">Episodes</h2>
        <span className="text-sm text-muted">{formatBytes(episodes.reduce((n, e) => n + e.bytes, 0))} used</span>
      </div>
      {error && <Notice tone="danger" className="m-4">{error}</Notice>}
      {episodes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="grid size-14 place-items-center rounded-[10px] border border-dashed border-border-strong">
            <span className="size-3.5 rounded-full bg-accent" />
          </span>
          <span className="text-[17px] font-semibold">No episodes yet</span>
          <span className="text-[15px] text-muted">Enter the studio and press Record. Your episode will appear here.</span>
        </div>
      ) : (
        <ul>
          {episodes.map((e) => (
            <EpisodeRow
              key={e.id}
              showId={showId}
              episode={e}
              now={now}
              open={open === e.id}
              levelLoudness={levelLoudness}
              onToggle={() => setOpen(open === e.id ? null : e.id)}
              onProcessNow={() => processNow(e)}
              onRemove={() => remove(e)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function EpisodeRow({
  showId,
  episode: e,
  now,
  open,
  levelLoudness,
  onToggle,
  onProcessNow,
  onRemove,
}: {
  showId: string;
  episode: Episode;
  now: number;
  open: boolean;
  levelLoudness: boolean;
  onToggle: () => void;
  onProcessNow: () => void;
  onRemove: () => Promise<void>;
}) {
  const p = phase(e);
  const guests = e.people.filter((x) => x.role === "guest").length;
  const length = e.stoppedAt ? formatDuration(e.stoppedAt - e.startedAt) : `${formatClock(now - e.startedAt)} so far`;
  const missing = e.people.filter((x) => x.completeTracks < x.tracks).map((x) => x.name);
  const waiting = e.status === "stopped" && e.processing === "pending" && e.incompleteTracks > 0;

  let note: { text: string; tone: "warn" | "danger" } | null = null;
  if (e.status === "recording") note = { text: "You're live. Everyone's recording is being saved and sent as you talk.", tone: "warn" };
  else if (waiting)
    note = {
      text: `${listNames(missing)}'s recording is still on its way from their computer. It finishes by itself as soon as they're back online. If they won't be back, you can finish without them.`,
      tone: "warn",
    };
  else if (e.processing === "queued" || e.processing === "processing")
    note = { text: levelLoudness ? "Lining up everyone's recordings and evening out the volume…" : "Lining up everyone's recordings…", tone: "warn" };
  else if (e.processing === "failed")
    note = { text: e.processingError ?? "We couldn't finish the files for this episode. Your recordings are safe; try again.", tone: "danger" };

  return (
    <li className="border-b border-border last:border-0" data-testid="recording">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full cursor-pointer flex-wrap items-center gap-4 px-6 py-[18px] text-left",
          open ? "bg-surface" : "bg-surface hover:bg-surface-2/60",
        )}
      >
        <span className="flex min-w-[200px] flex-1 flex-col gap-[3px]">
          <span className="text-base font-semibold">Episode {e.number}</span>
          <span className="text-sm text-muted">
            {formatWhen(e.startedAt, now)} · {length} · {guests} guest{guests === 1 ? "" : "s"} ·{" "}
            <span data-testid="recording-bytes">{formatBytes(e.bytes)}</span>
          </span>
        </span>
        <StatusPill tone={p.tone} data-testid="recording-status">
          {p.label}
        </StatusPill>
        <span aria-hidden className="w-3.5 text-xs text-subtle">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 bg-surface px-6 pb-6">
          {note && (
            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-dashed px-4 py-3.5 text-[15px] text-text-2",
                note.tone === "danger" ? "border-accent-line" : "border-warn-line",
              )}
            >
              <span className="text-pretty">{note.text}</span>
              {(waiting || e.processing === "failed") && (
                <Button variant="secondary" className="h-10 px-[18px] text-sm" onClick={onProcessNow}>
                  {e.processing === "failed" ? "Try again" : "Finish without them"}
                </Button>
              )}
            </div>
          )}

          {e.processing !== "ready" && e.people.length > 0 && <PeopleProgress episode={e} />}

          {e.processing === "ready" && <Downloads showId={showId} episode={e} />}

          {e.status === "stopped" && (
            <div>
              <ConfirmAction
                label="Delete this episode…"
                testId="delete-recording"
                question={
                  <>
                    Delete Episode {e.number} and all of its files from the server? This can&apos;t be undone.
                    {e.incompleteTracks > 0 && " Guests still sending it will stop, and their copies are discarded."}
                  </>
                }
                confirmLabel="Delete episode"
                action={onRemove}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** One line per person: recording, still arriving, or received. */
function PeopleProgress({ episode: e }: { episode: Episode }) {
  return (
    <div className="flex flex-col gap-2.5">
      {e.people.map((x) => {
        const done = x.tracks > 0 && x.completeTracks === x.tracks;
        const recording = e.status === "recording";
        const label = recording ? `Recording · ${formatBytes(x.bytes)} sent` : done ? "Received ✓" : `Still arriving · ${formatBytes(x.bytes)} so far`;
        return (
          <div key={x.participantId} className="grid grid-cols-[minmax(80px,140px)_minmax(0,1fr)_auto] items-center gap-3.5 text-sm">
            <span className="truncate font-medium">{x.name}</span>
            <div className="h-1.5 overflow-hidden rounded-[3px] bg-border">
              <div
                className={cn("h-full", recording ? "w-full animate-rec-pulse bg-accent" : done ? "w-full bg-ok" : "w-1/2 animate-rec-pulse bg-warn")}
              />
            </div>
            <span className={cn("text-right", done ? "text-ok-strong" : "text-muted")}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

const FILE_ICON: Record<string, string> = { audio: "∿", video: "▶", combined: "▦", transcript: "Aa" };

/** What a downloaded file is, in words: "Ines's audio", "Side-by-side video", "Captions (.srt)". */
function describe(o: Episode["outputs"][number]) {
  const ext = o.fileName.split(".").pop()?.toUpperCase() ?? "";
  if (o.kind === "combined") return { title: "Side-by-side video", icon: FILE_ICON.combined!, format: ext };
  if (o.kind === "transcript") {
    return o.fileName.endsWith(".txt")
      ? { title: "Transcript", icon: FILE_ICON.transcript!, format: "Text" }
      : { title: `Captions (.${ext.toLowerCase()})`, icon: "cc", format: ext };
  }
  const who = o.fileName.replace(/ - (audio|video)\.\w+$/, "");
  return { title: `${who}'s ${o.kind}`, icon: FILE_ICON[o.kind]!, format: ext };
}

function Downloads({ showId, episode: e }: { showId: string; episode: Episode }) {
  const transcribing = e.transcript === "queued" || e.transcript === "processing";
  const total = e.outputs.reduce((n, o) => n + o.bytes, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-muted" data-testid="transcript-status">
          {transcribing && (
            <>
              <StatusDot tone="warn" /> Writing the transcript… you can download everything else now.
            </>
          )}
          {e.transcript === "ready" && (
            <>
              <StatusDot tone="ok" /> Transcript ready
            </>
          )}
          {e.transcript === "failed" && (
            <>
              <StatusDot tone="danger" /> The transcript couldn&apos;t be made. The recording itself is fine.
            </>
          )}
        </span>
        {e.outputs.length > 1 && (
          <a
            href={`/api/studios/${showId}/recordings/${e.id}/zip`}
            className="inline-flex h-11 items-center rounded-xl bg-accent px-[22px] text-[15px] font-semibold whitespace-nowrap text-accent-text hover:bg-accent-hover"
            data-testid="download-zip"
          >
            ↓ Download everything · {formatBytes(total)}
          </a>
        )}
      </div>
      {e.rawDeleted && (
        <p className="text-[13px] text-subtle" data-testid="originals-removed">
          The original uploads were removed after this server&apos;s retention period. These files are what&apos;s kept.
        </p>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,250px),1fr))] gap-2">
        {e.outputs.map((o) => {
          const d = describe(o);
          return (
            <li key={o.id}>
              <a
                href={`/api/studios/${showId}/recordings/${e.id}/outputs/${o.id}`}
                className="flex items-center gap-3 rounded-[10px] border border-border px-3.5 py-3 text-text hover:border-border-strong"
                data-testid="download"
                data-file-name={o.fileName}
                title={o.fileName}
              >
                <span aria-hidden className="grid size-[34px] shrink-0 place-items-center rounded-lg border border-border-strong text-[13px]">
                  {d.icon}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{d.title}</span>
                  <span className="text-xs text-muted">
                    {d.format} · {formatBytes(o.bytes)}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function listNames(names: string[]) {
  if (names.length === 0) return "A guest";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
