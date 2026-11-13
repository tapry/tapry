"use client";

// The studio's guide (run of show): the host's plan for a session, typed as plain lines. It
// shows beside the call for hosts only, where each item can be ticked off as it's covered.
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { parseGuide } from "@/lib/guide";
import { Button, cn } from "./ui";
import { ListCard } from "./ui-extra";

export function GuideEditor({ studioId, initial }: { studioId: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const items = parseGuide(text).filter((l) => l.kind === "item").length;

  async function save() {
    setStatus(null);
    try {
      const { guide } = await apiFetch<{ guide: string }>(`/studios/${studioId}/guide`, { method: "PUT", body: { guide: text } });
      setSaved(guide);
      setStatus({ tone: "ok", text: "✓ Saved" });
    } catch (err) {
      setStatus({ tone: "danger", text: err instanceof ApiRequestError ? err.message : "Couldn't save. Try again." });
    }
  }

  return (
    <ListCard data-testid="guide-editor">
      <div className="flex flex-col gap-3 py-4">
        <span className="flex flex-col gap-[3px]">
          <label htmlFor="guide" className="font-medium">
            Guide
          </label>
          <span className="text-[13px] leading-normal text-pretty text-muted">
            Your plan for a session: one question or segment per line, and lines starting with # as section headings. Only hosts see it, beside the call, and tick items off as they go. A tick
            during a recording sets a marker at that moment.
          </span>
        </span>
        <textarea
          id="guide"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={8000}
          rows={9}
          placeholder={"# Opening\nIntroduce the guest\nWhat got you started?\n# Main part\n…"}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-text shadow-xs placeholder:text-subtle focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none"
        />
        <div className="flex items-center gap-3.5">
          <Button type="button" onClick={() => void save()} disabled={text === saved}>
            Save guide
          </Button>
          <span className="text-[13px] text-muted">
            {items} {items === 1 ? "item" : "items"}
          </span>
          {status && <span className={cn("text-sm", status.tone === "ok" ? "text-ok-strong" : "text-danger")}>{status.text}</span>}
        </div>
      </div>
    </ListCard>
  );
}
