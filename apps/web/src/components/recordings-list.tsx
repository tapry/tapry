"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { formatBytes } from "@/lib/format";
import type { RecordingSummary } from "@/server/processing";
import { ConfirmAction } from "./confirm-action";
import { Button, cn, Notice, StatusDot } from "./ui";
const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function phase(r: RecordingSummary) {
  if (r.status === "recording") return { tone: "danger", label: "Recording" } as const;
  if (r.processing === "ready") return { tone: "ok", label: "Ready" } as const;
  if (r.processing === "failed") return { tone: "danger", label: "Failed" } as const;
  if (r.processing === "queued" || r.processing === "processing") return { tone: "warn", label: "Processing…" } as const;
  return { tone: "warn", label: r.incompleteTracks ? "Waiting for uploads" : "Waiting" } as const;
}

const settled = (r: RecordingSummary) =>
  (r.processing === "ready" || r.processing === "failed") && r.transcript !== "queued" && r.transcript !== "processing";

/** A studio's recordings with their state and download links. Polls while anything is in flight. */
export function RecordingsList({ studioId, initial }: { studioId: string; initial: RecordingSummary[] }) {
  const router = useRouter();
  const [recordings, setRecordings] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inFlight = recordings.some((r) => !settled(r));

  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(async () => {
      try {
        setRecordings((await apiFetch<{ recordings: RecordingSummary[] }>(`/studios/${studioId}/recordings`)).recordings);
      } catch {
        // Keep showing the last known state; the next poll retries.
      }
    }, 3000);
    return () => clearInterval(id);
  }, [studioId, inFlight]);

  async function processNow(r: RecordingSummary) {
    setError(null);
    try {
      await apiFetch(`/studios/${studioId}/recordings/${r.id}/process`, { body: {} });
      setRecordings((list) => list.map((x) => (x.id === r.id ? { ...x, processing: "queued" } : x)));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't start processing.");
    }
  }

  async function remove(r: RecordingSummary) {
    await apiFetch(`/studios/${studioId}/recordings/${r.id}`, { method: "DELETE" });
    setRecordings((list) => list.filter((x) => x.id !== r.id));
    router.refresh(); // the studio's storage total
  }

  if (recordings.length === 0) {
    return <p className="text-sm text-muted">No recordings yet. Enter the studio and press Record.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <Notice tone="danger">{error}</Notice>}
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {recordings.map((r) => {
          const p = phase(r);
          const canForce = r.status === "stopped" && (r.processing === "pending" || r.processing === "failed");
          return (
            <li key={r.id} className="space-y-3 p-4" data-testid="recording">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {new Date(r.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                  <p className="text-sm text-muted">
                    {r.stoppedAt ? clock(r.stoppedAt - r.startedAt) : "in progress"} · {r.tracks} track
                    {r.tracks === 1 ? "" : "s"} · <span data-testid="recording-bytes">{formatBytes(r.bytes)}</span>
                  </p>
                </div>
                <span className="flex items-center gap-2 text-sm" data-testid="recording-status">
                  <StatusDot tone={p.tone} /> {p.label}
                </span>
              </div>

              {r.processing === "pending" && r.incompleteTracks > 0 && r.status === "stopped" && (
                <p className="text-sm text-muted">
                  {r.incompleteTracks} track{r.incompleteTracks === 1 ? " is" : "s are"} still uploading. If a guest left
                  for good, process without them.
                </p>
              )}
              {r.processingError && <Notice tone="danger">{r.processingError}</Notice>}
              {canForce && (
                <Button variant="secondary" onClick={() => processNow(r)}>
                  {r.processing === "failed" ? "Try again" : "Process now"}
                </Button>
              )}

              {r.processing === "ready" && (r.transcript === "queued" || r.transcript === "processing") && (
                <p className="flex items-center gap-2 text-sm text-muted" data-testid="transcript-status">
                  <StatusDot tone="warn" /> Transcribing… the files below are ready to download already.
                </p>
              )}
              {r.processing === "ready" && r.transcript === "failed" && (
                <p className="flex items-center gap-2 text-sm text-muted" data-testid="transcript-status">
                  <StatusDot tone="danger" /> The transcript couldn't be made. The recording itself is fine.
                </p>
              )}
              {r.processing === "ready" && r.outputs.length > 1 && (
                <a
                  href={`/api/studios/${studioId}/recordings/${r.id}/zip`}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-text px-4 text-sm font-medium text-bg hover:opacity-90"
                  data-testid="download-zip"
                >
                  Download all (.zip) · {formatBytes(r.outputs.reduce((n, o) => n + o.bytes, 0))}
                </a>
              )}
              {r.processing === "ready" && (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {r.outputs.map((o) => (
                    <li key={o.id}>
                      <a
                        href={`/api/studios/${studioId}/recordings/${r.id}/outputs/${o.id}`}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2",
                          o.kind === "combined" && "sm:col-span-2",
                        )}
                        data-testid="download"
                      >
                        <span className="truncate">{o.fileName}</span>
                        <span className="shrink-0 text-muted">{formatBytes(o.bytes)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              {r.status === "stopped" && (
                <ConfirmAction
                  label="Delete"
                  testId="delete-recording"
                  question={
                    <>
                      Delete this recording and all of its files from the server? This can&apos;t be undone.
                      {r.incompleteTracks > 0 && " Guests still uploading it will stop, and their copies are discarded."}
                    </>
                  }
                  confirmLabel="Delete recording"
                  action={() => remove(r)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
