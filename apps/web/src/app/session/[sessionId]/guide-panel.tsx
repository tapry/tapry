"use client";

// The host's guide beside the call: the studio's run of show, each item ticked off as it's
// covered, and a Mark button. While a recording runs, a tick or a press sets a marker at that
// moment (timed by the server), which the timeline exports carry. Guests never get any of it.
import type { SessionTicket } from "@tapry/shared";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { markerLabel, parseGuide, type GuideLine } from "@/lib/guide";
import { shortClock } from "@/lib/format";
import { cn } from "@/components/ui";

interface Marker {
  id: string;
  atMs: number;
  label: string;
}

export function GuidePanel({ ticket, recordingId, title = "Guide" }: { ticket: SessionTicket; recordingId: string | null; /** "Questions" for someone recording alone. */ title?: string }) {
  const [lines, setLines] = useState<GuideLine[] | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const storeKey = `tapry:guide-done:${ticket.sessionId}`;

  useEffect(() => {
    let gone = false;
    apiFetch<{ guide: string }>(`/sessions/${ticket.sessionId}/guide`, { token: ticket.token })
      .then(({ guide }) => !gone && setLines(parseGuide(guide)))
      .catch(() => !gone && setLines([]));
    try {
      const kept = JSON.parse(sessionStorage.getItem(storeKey) ?? "[]") as number[];
      setDone(new Set(kept));
    } catch {}
    return () => {
      gone = true;
    };
  }, [ticket, storeKey]);
  // A new recording starts with no markers of its own.
  useEffect(() => setMarkers([]), [recordingId]);

  async function mark(label: string) {
    if (!recordingId) return;
    setProblem(null);
    try {
      const marker = await apiFetch<Marker>(`/sessions/${ticket.sessionId}/markers`, { body: { label: markerLabel(label) }, token: ticket.token });
      setMarkers((m) => [...m, marker]);
    } catch {
      setProblem("That marker couldn't be set.");
    }
  }

  function toggle(i: number, text: string) {
    const next = new Set(done);
    if (next.has(i)) next.delete(i);
    else {
      next.add(i);
      void mark(text);
    }
    setDone(next);
    try {
      sessionStorage.setItem(storeKey, JSON.stringify([...next]));
    } catch {}
  }

  if (lines === null) return null;
  const items = lines.filter((l) => l.kind === "item").length;
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface px-3 py-3" data-testid="guide-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-medium">
          {title}{items > 0 && <span className="font-normal text-muted"> · {[...done].length} of {items}</span>}
        </h2>
        <button
          type="button"
          disabled={!recordingId}
          onClick={() => void mark("Marker")}
          title={recordingId ? "Mark this moment in the recording" : "Markers are set while a recording runs"}
          className="cursor-pointer rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Mark this moment
        </button>
      </div>
      {lines.length === 0 ? (
        <p className="text-[13px] leading-normal text-muted">{title === "Guide" ? "No guide for this studio yet. Write one in the studio's settings: one question or segment per line." : "Say what you'd like to say, then press Stop."}</p>
      ) : (
        <ul className="flex max-h-[320px] flex-col gap-1 overflow-auto">
          {lines.map((l, i) =>
            l.kind === "section" ? (
              <li key={i} className="pt-1.5 text-[12.5px] font-medium tracking-wide text-muted uppercase">
                {l.text}
              </li>
            ) : (
              <li key={i}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 text-[13.5px] leading-snug hover:bg-surface-2">
                  <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i, l.text)} className="mt-0.5 size-4 shrink-0" />
                  <span className={cn(done.has(i) && "text-muted line-through")}>{l.text}</span>
                </label>
              </li>
            ),
          )}
        </ul>
      )}
      {markers.length > 0 && (
        <p className="text-[12.5px] text-muted" data-testid="guide-markers">
          {markers.length} {markers.length === 1 ? "marker" : "markers"} in this recording · last at {shortClock(markers.at(-1)!.atMs)}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-[12.5px] text-danger">
          {problem}
        </p>
      )}
    </section>
  );
}
