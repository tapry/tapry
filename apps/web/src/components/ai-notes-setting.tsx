"use client";

// Settings → Account: how AI notes are written for this account. A model on the server needs no
// switch (nothing leaves it). An outside model is off until the account's owner turns it on,
// and the text says plainly what is sent where.
import type { AiNotesView } from "@tapry/shared";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { cn } from "./ui";
import { ListCard } from "./ui-extra";

export function AiNotesSetting({ initial }: { initial: AiNotesView }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(outside: boolean) {
    setBusy(true);
    setError(null);
    try {
      setView(await apiFetch<AiNotesView>("/ai-notes", { method: "PUT", body: { outside } }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const title = <span className="font-medium">AI notes</span>;
  const what = "A summary, chapters, key points, quotes and show notes, written from each recording's transcript as a draft for you to edit.";

  if (view.localModel) {
    return (
      <ListCard data-testid="ai-notes">
        <div className="flex flex-col gap-[3px] py-4">
          {title}
          <span className="text-[14px] leading-normal text-pretty text-muted">
            {what} Written by an AI model on this server ({view.localModel}): the transcript doesn&apos;t leave it.
          </span>
        </div>
      </ListCard>
    );
  }
  if (!view.outsideModel) {
    return (
      <ListCard data-testid="ai-notes">
        <div className="flex flex-col gap-[3px] py-4">
          {title}
          <span className="text-[14px] leading-normal text-pretty text-muted">{what} Not set up on this server.</span>
        </div>
      </ListCard>
    );
  }
  const locked = !view.canChange || (!view.planAllows && !view.outsideOn);
  return (
    <ListCard data-testid="ai-notes">
      <label className={cn("flex items-center justify-between gap-x-6 gap-y-3 py-4", locked ? "cursor-not-allowed" : "cursor-pointer")}>
        <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
          {title}
          <span className="text-[14px] leading-normal text-pretty text-muted">
            {what} To write them, each recording&apos;s transcript text is sent to Anthropic, an outside AI company ({view.outsideModel}). Sound and picture are never sent. Off, nothing is sent
            and no notes are written.
          </span>
          {!view.planAllows && <span className="text-[14px] text-warn-strong">{view.outsideOn ? "Your plan no longer includes AI notes, so none are written." : "AI notes are part of the paid plans."}</span>}
          {!view.canChange && <span className="text-[14px] text-muted">Only the account&apos;s owner can change this.</span>}
          {error && (
            <span role="alert" className="text-[14px] text-danger">
              {error}
            </span>
          )}
        </span>
        <input type="checkbox" role="switch" aria-label="AI notes with an outside model" className="peer sr-only" checked={view.outsideOn} disabled={busy || locked} onChange={(e) => void set(e.target.checked)} />
        <span
          aria-hidden
          className="relative h-5 w-9 shrink-0 rounded-full bg-subtle transition-colors duration-[250ms] peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-50 peer-checked:[&>span]:left-[18px]"
        >
          <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-surface shadow-xs transition-[left] duration-[250ms] ease-[cubic-bezier(.2,.7,.2,1)]" />
        </span>
      </label>
    </ListCard>
  );
}
