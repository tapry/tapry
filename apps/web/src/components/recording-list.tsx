"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { formatBytes, formatClock, formatDuration, formatWhen } from "@/lib/format";
import type { RecordingSummary } from "@/server/processing";
import { ConfirmAction } from "./confirm-action";
import { describeOutput, phase, STATUS } from "./recordings";
import { RecordingTimeline } from "./recording-timeline";
import { Icon } from "./ui-extra";
import { Avatar, Button, cn, Notice, StatusDot } from "./ui";

type Recording = RecordingSummary;

/** Nothing more will change without someone acting: no polling needed. */
export const settled = (e: Recording) =>
  (e.processing === "ready" || e.processing === "failed") && e.transcript !== "queued" && e.transcript !== "processing";

/** A studio's recordings, newest first. The newest is open; click a row to open or close it. */
export function RecordingList({
  studioId,
  recordings,
  now,
  levelLoudness,
  onChange,
}: {
  studioId: string;
  recordings: Recording[];
  now: number;
  levelLoudness: boolean;
  onChange: (update: (list: Recording[]) => Recording[]) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(recordings[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  async function processNow(e: Recording) {
    setError(null);
    try {
      await apiFetch(`/studios/${studioId}/recordings/${e.id}/process`, { body: {} });
      onChange((list) => list.map((x) => (x.id === e.id ? { ...x, processing: "queued" } : x)));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't start processing.");
    }
  }

  async function remove(e: Recording) {
    await apiFetch(`/studios/${studioId}/recordings/${e.id}`, { method: "DELETE" });
    onChange((list) => list.filter((x) => x.id !== e.id));
    router.refresh(); // the studio's space used and the sidebar
  }

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-medium">Recordings</h2>
        <span className="text-[13px] text-muted">{formatBytes(recordings.reduce((n, e) => n + e.bytes, 0))} used</span>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {recordings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <span className="mb-1 grid size-11 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <Icon name="rec" size={20} />
          </span>
          <span className="font-medium">No recordings yet</span>
          <span className="text-muted">Enter the studio and press Record. Your recording will appear here.</span>
        </div>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface px-[18px] py-1">
          {recordings.map((e) => (
            <RecordingRow
              key={e.id}
              studioId={studioId}
              recording={e}
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
    </section>
  );
}

function RecordingRow({
  studioId,
  recording: e,
  now,
  open,
  levelLoudness,
  onToggle,
  onProcessNow,
  onRemove,
}: {
  studioId: string;
  recording: Recording;
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
  else if (e.processing === "failed")
    note = { text: e.processingError ?? "We couldn't finish the files for this recording. Your recordings are safe; try again.", tone: "danger" };
  else if (e.processing === "ready" && e.skippedTracks.length > 0)
    note = {
      text: `We couldn't read ${listNames(e.skippedTracks.map((t) => `${t.name}'s ${t.kind}`))}, so it's missing from these files. Everyone else's are fine. The upload is kept, so you can try again.`,
      tone: "warn",
    };

  return (
    <li className="border-b border-divider last:border-0" data-testid="recording">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        // One column on a phone (who, then the status, then when): beside the status, the title has no room.
        className="-mx-2 grid w-[calc(100%+16px)] cursor-pointer grid-cols-1 items-center gap-x-5 gap-y-1.5 rounded-xl px-2 py-3.5 text-left transition-colors hover:bg-canvas sm:grid-cols-[minmax(0,3fr)_auto_auto_auto_14px]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Faces names={e.people.map((x) => x.name)} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">Recording {e.number}</span>
            <span className="truncate text-[13px] text-muted">
              {guests} guest{guests === 1 ? "" : "s"} · <span data-testid="recording-bytes">{formatBytes(e.bytes)}</span>
            </span>
          </span>
        </span>
        <span className="hidden whitespace-nowrap text-muted sm:inline">{formatWhen(e.startedAt, now)}</span>
        <span className="hidden whitespace-nowrap text-muted tabular-nums sm:inline">{length}</span>
        <span className={cn("flex items-center gap-[7px] whitespace-nowrap", STATUS[p.tone].color)} data-testid="recording-status">
          <Icon name={STATUS[p.tone].icon} className={p.tone === "live" ? "animate-rec-pulse" : undefined} />
          {p.label}
        </span>
        <Icon name="back" size={14} className={cn("hidden text-subtle transition-transform sm:block", open ? "rotate-90" : "-rotate-90")} />
        <span className="text-[13px] text-muted sm:hidden">
          {formatWhen(e.startedAt, now)} · {length}
        </span>
      </button>

      {open && (
        <div className="flex animate-fade-up flex-col gap-4 pt-1 pb-5">
          {note && (
            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 rounded-lg px-3.5 py-3 text-sm leading-normal",
                note.tone === "danger" ? "bg-accent-soft text-accent-strong" : "bg-warn-soft text-warn-strong",
              )}
            >
              <span className="flex min-w-0 flex-[1_1_260px] items-start gap-2 text-pretty">
                <Icon name="alert" size={15} className="mt-0.5" />
                {note.text}
              </span>
              {(waiting || e.processing === "failed" || (e.processing === "ready" && e.skippedTracks.length > 0)) && (
                <Button variant="secondary" size="sm" onClick={onProcessNow}>
                  {waiting ? "Finish without them" : "Try again"}
                </Button>
              )}
            </div>
          )}

          {e.status === "stopped" && <RecordingTimeline recording={e} now={now} levelLoudness={levelLoudness} />}

          {/* Who is still sending: while recording, and until processing starts. */}
          {e.processing === "pending" && e.people.length > 0 && <PeopleProgress recording={e} />}

          {e.processing === "ready" && <Downloads studioId={studioId} recording={e} />}

          {e.status === "stopped" && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
              <a
                href={`/api/studios/${studioId}/recordings/${e.id}/consent`}
                className="flex items-center gap-2 text-[13.5px] text-muted hover:text-text"
                data-testid="consent-record"
              >
                <Icon name="shield" size={15} />
                Consent record: who agreed, when, to what (.txt)
              </a>
              <ConfirmAction
                label="Delete this recording…"
                testId="delete-recording"
                question={
                  <>
                    Delete Recording {e.number} and all of its files from the server? This can&apos;t be undone.
                    {e.incompleteTracks > 0 && " Guests still sending it will stop, and their copies are discarded."}
                  </>
                }
                confirmLabel="Delete recording"
                action={onRemove}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Up to three overlapping initials: who is in a recording. */
function Faces({ names }: { names: string[] }) {
  return (
    <span aria-hidden className="flex w-[62px] shrink-0 items-center pl-2">
      {names.slice(0, 3).map((n, i) => (
        <span key={`${n}-${i}`} className="-ml-2 rounded-full border-2 border-surface">
          <Avatar name={n} className="size-6 text-[9px]" />
        </span>
      ))}
    </span>
  );
}

/** One card per person: recording, still arriving, or received. */
function PeopleProgress({ recording: e }: { recording: Recording }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      {e.people.map((x) => {
        const done = x.tracks > 0 && x.completeTracks === x.tracks;
        const recording = e.status === "recording";
        // The size goes under the name, not in the label: on a phone the label would push the name out.
        const label = recording ? "Recording" : done ? "Received ✓" : "Still arriving";
        const size = `${formatBytes(x.bytes)}${recording ? " sent" : done ? "" : " so far"}`;
        return (
          <div key={x.participantId} className="-mt-px flex flex-col gap-2.5 border-t border-divider px-3.5 py-[13px]">
            <span className="flex items-center gap-[11px]">
              <span className="relative shrink-0">
                <Avatar name={x.name} className="size-[34px] text-xs" />
                <span
                  aria-hidden
                  className={cn(
                    "absolute -right-1 -bottom-1 grid size-[17px] place-items-center rounded-full border-2 border-surface text-surface",
                    recording ? "bg-accent" : done ? "bg-ok" : "bg-warn",
                  )}
                >
                  <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <path d={done && !recording ? "M20 6L9 17l-5-5" : "M12 19V5M5 12l7-7l7 7"} />
                  </svg>
                </span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-[14.5px] font-medium">{x.name}</span>
                <span className="truncate font-mono text-xs text-muted">{size}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-[3px] text-[12.5px] font-medium whitespace-nowrap",
                  recording ? "bg-accent-soft text-accent-strong" : done ? "bg-ok-soft text-ok-strong" : "bg-warn-soft text-warn-strong",
                )}
              >
                {label}
              </span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-[3px] bg-surface-2">
              <span
                className={cn(
                  "block h-full rounded-[3px]",
                  recording ? "w-full animate-rec-pulse bg-accent" : done ? "w-full bg-ok" : "w-1/2 animate-rec-pulse bg-warn",
                )}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Downloads({ studioId, recording: e }: { studioId: string; recording: Recording }) {
  const transcribing = e.transcript === "queued" || e.transcript === "processing";
  const total = e.outputs.reduce((n, o) => n + o.bytes, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col rounded-xl border border-border bg-surface px-[18px] py-1">
        <span className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 pb-2">
          <span className="font-medium">Files</span>
          {e.outputs.length > 1 && (
            <a
              href={`/api/studios/${studioId}/recordings/${e.id}/zip`}
              className="inline-flex h-[34px] items-center gap-[7px] rounded-md bg-ink px-3 text-sm font-medium whitespace-nowrap text-ink-text transition-colors hover:bg-ink-hover"
              data-testid="download-zip"
            >
              <Icon name="download" size={15} />
              Download all · {formatBytes(total)}
            </a>
          )}
        </span>
        <ul className="flex flex-col">
          {e.outputs.map((o) => {
            const d = describeOutput(o);
            return (
              <li key={o.id}>
                <a
                  href={`/api/studios/${studioId}/recordings/${e.id}/outputs/${o.id}`}
                  className="group flex items-center justify-between gap-3 border-t border-divider py-2.5 text-text hover:text-text"
                  data-testid="download"
                  data-file-name={o.fileName}
                  title={o.fileName}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon name={d.icon} size={15} className="text-muted" />
                    <span className="flex min-w-0 flex-col gap-px">
                      <span className="truncate">{d.title}</span>
                      <span className="text-[12.5px] text-muted">
                        {d.format} · {formatBytes(o.bytes)}
                      </span>
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface transition-colors group-hover:bg-surface-2"
                  >
                    <Icon name="download" size={15} />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
      <span className="flex items-center gap-2 text-[13px] text-muted empty:hidden" data-testid="transcript-status">
        {transcribing && (
          <>
            <StatusDot tone="warn" className="animate-rec-pulse" /> Writing the transcript… you can download everything else now.
          </>
        )}
      </span>
      {e.rawDeleted && (
        <p className="text-[13px] text-muted" data-testid="originals-removed">
          The original uploads were removed after this server&apos;s retention period. These files are what&apos;s kept.
        </p>
      )}
    </div>
  );
}

function listNames(names: string[]) {
  if (names.length === 0) return "A guest";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
