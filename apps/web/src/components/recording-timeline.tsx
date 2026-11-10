// A recording's way from Stop to files: recorded → uploaded → files ready → transcript, each with
// when it finished, and a progress bar on the step that's running.
import { formatDuration } from "@/lib/format";
import type { RecordingProgress, RecordingSummary } from "@/server/processing";
import { Icon } from "./ui-extra";
import { cn } from "./ui";

export interface TimelineStep {
  key: "recorded" | "uploaded" | "files" | "transcript";
  label: string;
  state: "done" | "current" | "todo" | "failed" | "skipped";
  detail: string | null;
  /** 0–1 on a running step that knows how far it is. */
  fraction?: number;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const took = (from: number | null, to: number) => (from && to - from >= 60_000 ? `took ${formatDuration(to - from)}` : null);
const join = (...parts: Array<string | null>) => parts.filter(Boolean).join(" · ") || null;

/** "Making Sam's audio (2 of 5)" and how far the whole job is (collecting 0–10%, rendering to 90%, saving to 100%). */
export function describeProgress(p: RecordingProgress): { text: string; fraction: number } {
  const of = (x: number) => (p.total > 0 ? Math.min(1, x / p.total) : 0);
  switch (p.stage) {
    case "collecting":
      return { text: `Collecting the uploads${p.current ? ` (${p.current})` : ""}`, fraction: 0.1 * of(p.done) };
    case "rendering":
      return { text: `Making ${p.current ?? "the files"} (${p.done + 1} of ${p.total})`, fraction: 0.1 + 0.8 * of(p.done) };
    case "saving":
      return { text: "Saving the files", fraction: 0.9 + 0.1 * of(p.done) };
    case "transcribing":
      return { text: `Transcribing ${p.current ?? ""} (${p.done + 1} of ${p.total})`.replace("  ", " "), fraction: of(p.done) };
  }
}

export function timelineSteps(e: RecordingSummary, now: number, levelLoudness: boolean): TimelineStep[] {
  const steps: TimelineStep[] = [];
  steps.push({
    key: "recorded",
    label: "Recorded",
    state: "done",
    detail: e.stoppedAt ? join(time(e.stoppedAt), formatDuration(e.stoppedAt - e.startedAt)) : null,
  });

  const missing = e.people.filter((x) => x.completeTracks < x.tracks).map((x) => x.name);
  const started = e.processing !== "pending";
  if (e.uploadedAt) {
    steps.push({ key: "uploaded", label: "Everyone's upload arrived", state: "done", detail: time(e.uploadedAt) });
  } else if (missing.length > 0 && started) {
    steps.push({ key: "uploaded", label: "Finished without everyone's upload", state: "skipped", detail: `Missing: ${missing.join(", ")}` });
  } else if (missing.length > 0) {
    steps.push({ key: "uploaded", label: "Uploading", state: "current", detail: `Waiting for ${missing.join(", ")}` });
  } else {
    steps.push({ key: "uploaded", label: "Everyone's upload arrived", state: "done", detail: null }); // from before times were kept
  }

  const making = levelLoudness ? "Lined up, volume evened out, files made" : "Lined up and files made";
  if (e.processing === "ready") {
    steps.push({
      key: "files",
      label: "Files ready",
      state: "done",
      detail: e.processedAt ? join(time(e.processedAt), took(e.processingStartedAt, e.processedAt)) : null,
    });
  } else if (e.processing === "processing") {
    const p = e.progress ? describeProgress(e.progress) : null;
    steps.push({
      key: "files",
      label: making,
      state: "current",
      detail: join(p?.text ?? "Starting", e.processingStartedAt ? `${formatDuration(now - e.processingStartedAt)} so far` : null),
      fraction: p?.fraction ?? 0,
    });
  } else if (e.processing === "queued") {
    steps.push({ key: "files", label: making, state: "current", detail: "Waiting for its turn" });
  } else if (e.processing === "failed") {
    steps.push({ key: "files", label: "Files couldn't be made", state: "failed", detail: e.processingError });
  } else {
    steps.push({ key: "files", label: "Files", state: "todo", detail: null });
  }

  // Shown once it's known whether this server transcribes (set when the files are ready).
  if (e.transcript !== "off") {
    if (e.transcript === "ready") {
      steps.push({ key: "transcript", label: "Transcript ready", state: "done", detail: e.transcribedAt ? join(time(e.transcribedAt), took(e.processedAt, e.transcribedAt)) : null });
    } else if (e.transcript === "processing") {
      const p = e.progress?.stage === "transcribing" ? describeProgress(e.progress) : null;
      steps.push({ key: "transcript", label: "Transcribing", state: "current", detail: p?.text ?? null, fraction: p?.fraction ?? 0 });
    } else if (e.transcript === "queued") {
      steps.push({ key: "transcript", label: "Transcript", state: "current", detail: "Waiting for its turn" });
    } else {
      steps.push({ key: "transcript", label: "Transcript couldn't be made", state: "failed", detail: "The files are fine; only the transcript is missing." });
    }
  }
  return steps;
}

export function RecordingTimeline({ recording, now, levelLoudness }: { recording: RecordingSummary; now: number; levelLoudness: boolean }) {
  const steps = timelineSteps(recording, now, levelLoudness);
  return (
    <ol className="flex flex-col rounded-xl border border-border bg-surface px-[18px] py-3.5" aria-label="Processing timeline" data-testid="timeline">
      {steps.map((s, i) => (
        <li key={s.key} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3" data-step={s.key} data-state={s.state}>
          <span className="flex flex-col items-center">
            <span
              aria-hidden
              className={cn(
                "grid size-[22px] shrink-0 place-items-center rounded-full text-[11px] font-medium",
                s.state === "done" && "text-ok-strong",
                s.state === "current" && "text-warn-strong",
                s.state === "failed" && "text-accent-strong",
                (s.state === "todo" || s.state === "skipped") && "bg-surface-2 text-muted",
              )}
            >
              {s.state === "done" ? (
                <Icon name="check" size={18} />
              ) : s.state === "failed" ? (
                <Icon name="alert" size={17} />
              ) : s.state === "current" ? (
                <Icon name="loader" size={16} className="animate-spin-fast [animation-duration:1.4s]" />
              ) : s.state === "skipped" ? (
                "–"
              ) : (
                i + 1
              )}
            </span>
            {i < steps.length - 1 && <span aria-hidden className={cn("my-1 w-px flex-1", s.state === "done" ? "bg-ok-line" : "bg-border")} />}
          </span>
          <span className={cn("flex min-w-0 flex-col gap-0.5", i < steps.length - 1 && "pb-3.5")}>
            <span className={cn("leading-[22px] font-medium", s.state === "todo" && "text-muted")}>{s.label}</span>
            {s.detail && <span className={cn("text-[13px]", s.state === "failed" ? "text-accent-strong" : "text-muted")}>{s.detail}</span>}
            {s.fraction !== undefined && (
              <span
                className="mt-1 flex max-w-[360px] items-center gap-2.5"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(s.fraction * 100)}
              >
                <span className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-surface-2">
                  <span className="block h-full rounded-[3px] bg-warn transition-[width] duration-500" style={{ width: `${Math.max(3, s.fraction * 100)}%` }} />
                </span>
                <span aria-hidden className="w-[34px] text-right text-[12.5px] text-muted tabular-nums">
                  {Math.round(s.fraction * 100)}%
                </span>
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
