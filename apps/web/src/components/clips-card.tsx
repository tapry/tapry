"use client";

// Clips of a finished recording: name a start and an end (type them, or take them from the
// transcript), and that stretch of the combined video is cut out as a file of its own.
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { formatBytes, shortClock } from "@/lib/format";
import type { Clip } from "@/server/clips";
import { Button } from "./ui";

/** "1:05", "65" or "1:02:03" as milliseconds; null when it isn't a time. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return Math.round(parts.reduce((total, p) => total * 60 + Number(p), 0) * 1000);
}

export function ClipsCard({ studioId, recordingId, clips, lengthMs }: { studioId: string; recordingId: string; clips: Clip[]; lengthMs: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const waiting = clips.some((c) => c.status === "queued");

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [waiting, router]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const startMs = parseClock(String(data.get("from") ?? ""));
    const endMs = parseClock(String(data.get("to") ?? ""));
    if (startMs === null || endMs === null) return setProblem("Type the times like 1:05 or 12:30.");
    setBusy(true);
    setProblem(null);
    try {
      const title = String(data.get("title") ?? "").trim();
      await apiFetch(`/studios/${studioId}/recordings/${recordingId}/clips`, { body: { startMs, endMs, ...(title ? { title } : {}) } });
      form.reset();
      router.refresh();
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setProblem(null);
    try {
      await apiFetch(`/studios/${studioId}/recordings/${recordingId}/clips/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    }
  }

  const field = "h-[34px] min-w-0 rounded-md border border-border bg-surface px-2.5 text-sm text-text shadow-xs focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none";
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface px-[18px] pt-1 pb-3.5" data-testid="clips">
      <span className="pt-3 pb-2 font-medium">Clips</span>
      <span className="border-t border-divider pt-3 text-[14.5px] leading-normal text-pretty text-muted">
        Cut a stretch of this recording out as its own file. Take the times from the transcript; a clip can be up to ten minutes of the {shortClock(lengthMs)} recorded.
      </span>
      <form onSubmit={create} className="flex flex-wrap items-end gap-2 pt-3">
        <label className="flex flex-col gap-1 text-[13.5px] text-muted">
          From
          <input name="from" required placeholder="1:05" inputMode="numeric" className={`${field} w-[84px]`} />
        </label>
        <label className="flex flex-col gap-1 text-[13.5px] text-muted">
          To
          <input name="to" required placeholder="2:30" inputMode="numeric" className={`${field} w-[84px]`} />
        </label>
        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[13.5px] text-muted">
          Name (optional)
          <input name="title" maxLength={80} placeholder="The hard year" className={field} />
        </label>
        <Button type="submit" size="sm" disabled={busy}>
          Cut the clip
        </Button>
      </form>
      {problem && (
        <span role="alert" className="pt-2 text-[14px] text-danger">
          {problem}
        </span>
      )}
      {clips.length > 0 && (
        <div className="mt-3 flex flex-col">
          {clips.map((c) => (
            <span key={c.id} className="flex items-center justify-between gap-3 border-t border-divider py-2.5 text-[14.5px]" data-testid="clip" data-status={c.status}>
              <span className="flex min-w-0 flex-col gap-px">
                <span className="truncate">
                  {shortClock(c.startMs)} to {shortClock(c.endMs)}
                  {c.title && ` · ${c.title}`}
                </span>
                <span className="text-[13.5px] text-muted">{c.status === "queued" ? "Being cut…" : c.status === "failed" ? "Couldn't be cut. Delete it and try again." : `${c.output!.fileName.split(".").pop()!.toUpperCase()} · ${formatBytes(c.output!.bytes)}`}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {c.output && (
                  <a
                    href={`/api/studios/${studioId}/recordings/${recordingId}/outputs/${c.output.id}`}
                    data-file-name={c.output.fileName}
                    className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-text transition-colors hover:bg-surface-2 hover:text-text"
                  >
                    Download
                  </a>
                )}
                <button type="button" onClick={() => void remove(c.id)} className="cursor-pointer text-[13.5px] text-danger underline underline-offset-[3px]">
                  Delete
                </button>
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
