"use client";

import { useState, type ReactNode } from "react";
import { ApiRequestError } from "@/lib/client/api";
import { Button, Notice } from "./ui";

/**
 * A button that asks before doing something that can't be undone: the first click shows
 * `question` with a confirm and a cancel button, the confirm runs `action`.
 */
export function ConfirmAction({
  label,
  question,
  confirmLabel,
  action,
  testId,
  trigger = "link",
}: {
  label: string;
  /** How the first button looks: a quiet coral text link (default) or an outlined danger button. */
  trigger?: "link" | "button";
  question: ReactNode;
  confirmLabel: string;
  action: () => Promise<void>;
  testId?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await action();
      setAsking(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <Button
        variant={trigger === "button" ? "danger" : "ghost"}
        className={trigger === "link" ? "h-auto rounded-none p-0 text-sm font-medium text-accent-strong hover:bg-transparent hover:text-accent" : undefined}
        onClick={() => setAsking(true)}
        data-testid={testId}
      >
        {label}
      </Button>
    );
  }
  return (
    <div className="w-full space-y-3 rounded-xl border border-dashed border-accent-line bg-accent-soft/60 p-4" role="alertdialog">
      <p className="text-[15px] leading-normal">{question}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="record" className="rounded-full" onClick={confirm} disabled={busy} data-testid={testId && `${testId}-confirm`}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={() => setAsking(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}
