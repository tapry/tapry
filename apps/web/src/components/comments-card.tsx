"use client";

// Comments on a recording: notes the people of the account leave for each other, optionally at
// a moment of the recording. Viewers can comment too.
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { shortClock } from "@/lib/format";
import type { Comment } from "@/server/collab";
import { parseClock } from "./clips-card";
import { Button } from "./ui";

export function CommentsCard({ recordingId, comments }: { recordingId: string; comments: Comment[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      router.refresh();
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const at = String(data.get("at") ?? "").trim();
    const atMs = at ? parseClock(at) : undefined;
    if (atMs === null) return setProblem("Type the time like 1:05, or leave it empty.");
    void run(async () => {
      await apiFetch(`/recordings/${recordingId}/comments`, { body: { body: String(data.get("body") ?? ""), ...(atMs !== undefined ? { atMs } : {}) } });
      form.reset();
    });
  }

  const field = "min-w-0 rounded-md border border-border bg-surface px-2.5 text-sm text-text shadow-xs focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none";
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface px-[18px] pt-1 pb-3.5" data-testid="comments">
      <span className="pt-3 pb-2 font-medium">Comments{comments.length > 0 && <span className="font-normal text-muted"> · {comments.length}</span>}</span>
      {comments.map((c) => (
        <span key={c.id} className="flex flex-col gap-0.5 border-t border-divider py-2.5 text-[13.5px]" data-testid="comment">
          <span className="flex items-center justify-between gap-3">
            <span>
              <span className="font-medium">{c.author}</span>
              {c.atMs !== null && <span className="text-muted tabular-nums"> at {shortClock(c.atMs)}</span>}
              <span className="text-muted"> · {new Date(c.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
            </span>
            {c.mine && (
              <button type="button" disabled={busy} onClick={() => void run(() => apiFetch(`/recordings/${recordingId}/comments/${c.id}`, { method: "DELETE" }))} className="cursor-pointer text-[12.5px] text-danger underline underline-offset-[3px]">
                Delete
              </button>
            )}
          </span>
          <span className="leading-normal text-pretty whitespace-pre-line text-text-2">{c.body}</span>
        </span>
      ))}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-divider pt-3">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          At (optional)
          <input name="at" placeholder="1:05" className={`${field} h-[34px] w-[84px]`} />
        </label>
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[12.5px] text-muted">
          Comment
          <textarea name="body" required maxLength={2000} rows={1} className={`${field} py-1.5`} />
        </label>
        <Button type="submit" size="sm" disabled={busy}>
          Add
        </Button>
      </form>
      {problem && (
        <span role="alert" className="pt-2 text-[13px] text-danger">
          {problem}
        </span>
      )}
    </div>
  );
}
