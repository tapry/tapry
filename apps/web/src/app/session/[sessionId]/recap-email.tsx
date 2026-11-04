"use client";

import type { RecapStatus, SessionTicket } from "@tapry/shared";
import { useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";
import { apiFetch, ApiRequestError } from "@/lib/client/api";

/** "Email me my recording": asked for here, so nobody gets email unasked. */
export function RecapEmail({ ticket, recap, onChange }: { ticket: SessionTicket; recap: RecapStatus; onChange: (next: RecapStatus) => void }) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(recap.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange(await apiFetch<RecapStatus>(`/sessions/${ticket.sessionId}/recap`, { method: "POST", token: ticket.token, body: { email } }));
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const form = recap.status === "none" || editing;
  return (
    <div className="flex flex-col gap-2" data-testid="recap-email" data-status={recap.status}>
      {form && recap.canSend ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="recap-address" className="text-sm font-medium">
            Email me a link to my recording
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="recap-address"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 min-w-0 flex-[1_1_220px]"
            />
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? "Saving…" : "Email me"}
            </Button>
          </div>
          <p className="text-sm text-muted">Only used to send this one link, then deleted.</p>
        </form>
      ) : (
        <p className="text-sm text-text-2">
          {recap.status === "pending"
            ? `We'll email ${recap.email} when your file is ready.`
            : recap.status === "sent"
              ? "Sent. The link in the email works for 30 days."
              : "We couldn't send the email. You can still download your file here."}{" "}
          {recap.canSend && (
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => {
                setEmail(recap.email ?? "");
                setEditing(true);
              }}
            >
              {recap.status === "failed" ? "Try again" : "Use another address"}
            </button>
          )}
        </p>
      )}
      {error && <p className="text-sm text-accent-strong" role="alert">{error}</p>}
    </div>
  );
}
