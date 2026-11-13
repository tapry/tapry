"use client";

// A recording's AI notes: the draft as written (Markdown, shown as text), a download, and a
// button to have them written (again). Only shown where notes are on for the account or exist.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";

export function NotesCard({
  studioId,
  recordingId,
  state,
  error,
  text,
  downloadHref,
  canWrite,
}: {
  studioId: string;
  recordingId: string;
  state: "off" | "queued" | "processing" | "ready" | "failed";
  /** Why they couldn't be written, in words. */
  error: string | null;
  /** The notes' Markdown, when they exist and could be read. */
  text: string | null;
  downloadHref: string | null;
  /** Notes are on for this account and the transcript is ready. */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const working = state === "queued" || state === "processing";

  // While they're being written, look again every few seconds.
  useEffect(() => {
    if (!working) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [working, router]);

  async function write() {
    setBusy(true);
    setProblem(null);
    try {
      await apiFetch(`/studios/${studioId}/recordings/${recordingId}/notes`, { body: {} });
      router.refresh();
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface px-[18px] pt-1 pb-3.5" data-testid="notes" data-notes={state}>
      <span className="flex items-center justify-between gap-2 pt-3 pb-2 font-medium">
        AI notes
        <span className="flex items-center gap-[5px]">
          {downloadHref && (
            <a href={downloadHref} data-file-name="Notes.md" className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-normal text-text transition-colors hover:bg-surface-2 hover:text-text">
              MD
            </a>
          )}
          {canWrite && !working && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void write()}
              className="cursor-pointer rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-normal text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {state === "ready" ? "Write again" : "Write notes"}
            </button>
          )}
        </span>
      </span>
      {working ? (
        <span className="border-t border-divider py-3 text-[13.5px] text-muted">Writing the notes from the transcript…</span>
      ) : text ? (
        <pre className="max-h-[420px] overflow-auto border-t border-divider pt-3 font-sans text-[13.5px] leading-relaxed whitespace-pre-wrap text-text-2">{text}</pre>
      ) : (
        <span className="border-t border-divider py-3 text-[13.5px] text-muted">
          {state === "failed" ? (error ?? "The notes couldn't be written.") : canWrite ? "No notes yet for this recording." : "Notes are written once the transcript is ready."}
        </span>
      )}
      {problem && (
        <span role="alert" className="pt-2 text-[13px] text-danger">
          {problem}
        </span>
      )}
    </div>
  );
}
