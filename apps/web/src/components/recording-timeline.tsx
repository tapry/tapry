// A recording's way from Stop to files: recorded → uploaded → files ready → transcript, each with
// when it finished, and a progress bar on the step that's running.
import { formatDuration } from "@/lib/format";
import type { RecordingProgress, RecordingSummary } from "@/server/processing";
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
    <ol className="flex flex-col" aria-label="Processing timeline" data-testid="timeline">
      {steps.map((s, i) => (
        <li key={s.key} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3" data-step={s.key} data-state={s.state}>
          <span className="flex flex-col items-center">
            <span
              aria-hidden
              className={cn(
                "grid size-[22px] shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                s.state === "done" && "bg-ok-soft text-ok-strong",
                s.state === "current" && "bg-warn-soft text-warn-strong",
                s.state === "failed" && "bg-accent-soft text-accent-strong",
                (s.state === "todo" || s.state === "skipped") && "bg-surface-2 text-muted",
              )}
            >
              {s.state === "done" ? "✓" : s.state === "failed" ? "!" : s.state === "current" ? <span className="size-2 animate-rec-pulse rounded-full bg-warn" /> : s.state === "skipped" ? "–" : i + 1}
            </span>
            {i < steps.length - 1 && <span aria-hidden className={cn("w-px flex-1", s.state === "done" ? "bg-ok/40" : "bg-border")} />}
          </span>
          <span className={cn("flex min-w-0 flex-col gap-1", i < steps.length - 1 && "pb-4")}>
            <span className={cn("text-[15px] leading-[22px] font-medium", s.state === "todo" && "text-muted")}>{s.label}</span>
            {s.detail && <span className={cn("text-sm", s.state === "failed" ? "text-accent-strong" : "text-muted")}>{s.detail}</span>}
            {s.fraction !== undefined && (
              <span
                className="h-1.5 max-w-[360px] overflow-hidden rounded-full bg-border"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(s.fraction * 100)}
              >
                <span className="block h-full rounded-full bg-warn transition-[width] duration-500" style={{ width: `${Math.max(3, s.fraction * 100)}%` }} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
