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
  /** How the first button looks: a quiet text link (default) or an outlined danger button. */
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
        variant={trigger === "button" ? "danger" : "link"}
        size="sm"
        onClick={() => setAsking(true)}
        data-testid={testId}
      >
        {label}
      </Button>
    );
  }
  return (
    <div className="flex w-full animate-fade-up flex-col gap-3 rounded-xl border border-accent-line bg-accent-soft p-4" role="alertdialog">
      <p className="text-sm leading-normal text-pretty text-text">{question}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="record" size="sm" onClick={confirm} disabled={busy} data-testid={testId && `${testId}-confirm`}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setAsking(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}
