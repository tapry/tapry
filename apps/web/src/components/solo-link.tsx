"use client";

// A studio's solo link: people record alone on it, in their own time, answering what you ask.
// Each answer arrives as a recording of this studio.
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Button, cn } from "./ui";
import { ListCard } from "./ui-extra";

export function SoloLink({ studioId, initial }: { studioId: string; initial: { code: string | null; prompt: string } }) {
  const [code, setCode] = useState(initial.code);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [saved, setSaved] = useState(initial.prompt);
  const [status, setStatus] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const link = code && typeof window !== "undefined" ? `${window.location.origin}/solo/${code}` : null;

  async function save(enabled: boolean) {
    setStatus(null);
    try {
      const next = await apiFetch<{ code: string | null; prompt: string }>(`/studios/${studioId}/solo`, { method: "PUT", body: { enabled, prompt } });
      setCode(next.code);
      setSaved(next.prompt);
      setStatus({ tone: "ok", text: "✓ Saved" });
    } catch (err) {
      setStatus({ tone: "danger", text: err instanceof ApiRequestError ? err.message : "Couldn't save. Try again." });
    }
  }

  return (
    <ListCard data-testid="solo-link">
      <div className="flex flex-col gap-3 py-4">
        <span className="flex flex-col gap-[3px]">
          <span className="font-medium">Solo link</span>
          <span className="text-[14px] leading-normal text-pretty text-muted">
            A link where one person records alone, without you and without a call: answers to your questions, a statement, a voice note. They start and stop it themselves, up to 30 minutes, and
            each one arrives here as a recording. Anyone with the link can record, so share it with the people you mean.
          </span>
        </span>
        <label htmlFor="solo-prompt" className="text-[14px] text-muted">
          What you ask them (one question per line; they see it before and while they record)
        </label>
        <textarea
          id="solo-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={4000}
          rows={5}
          placeholder={"Tell us who you are\nWhat changed for you this year?"}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-text shadow-xs placeholder:text-subtle focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none"
        />
        {link && (
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={link} aria-label="Solo link" className="h-[34px] min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 text-[14px] text-text-2" onFocus={(e) => e.target.select()} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void navigator.clipboard.writeText(link).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1800)))}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3.5">
          {code ? (
            <>
              <Button type="button" onClick={() => void save(true)} disabled={prompt === saved}>
                Save questions
              </Button>
              <Button type="button" variant="secondary" onClick={() => confirm("Switch the solo link off? The link stops working; turning it on again later brings it back.") && void save(false)}>
                Switch off
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => void save(true)}>
              Turn on the solo link
            </Button>
          )}
          {status && <span className={cn("text-sm", status.tone === "ok" ? "text-ok-strong" : "text-danger")}>{status.text}</span>}
        </div>
      </div>
    </ListCard>
  );
}
