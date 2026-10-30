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
}: {
  label: string;
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
      <Button variant="ghost" onClick={() => setAsking(true)} data-testid={testId}>
        {label}
      </Button>
    );
  }
  return (
    <div className="w-full space-y-3 rounded-md border border-danger/40 bg-danger/10 p-3" role="alertdialog">
      <p className="text-sm">{question}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={confirm} disabled={busy} data-testid={testId && `${testId}-confirm`}>
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
