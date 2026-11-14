"use client";

import { useT } from "@/lib/i18n/client";
import type { RecapStatus, SessionTicket } from "@tapry/shared";
import { useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";
import { apiFetch, ApiRequestError } from "@/lib/client/api";

/** "Email me my recording": asked for here, so nobody gets email unasked. */
export function RecapEmail({ ticket, recap, onChange }: { ticket: SessionTicket; recap: RecapStatus; onChange: (next: RecapStatus) => void }) {
  const { locale, t } = useT();
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
      setError(err instanceof ApiRequestError && err.code !== "network" && locale === "en" ? err.message : t("recap.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const form = recap.status === "none" || editing;
  return (
    <div className="flex flex-col gap-2 border-t border-divider pt-3" data-testid="recap-email" data-status={recap.status}>
      {form && recap.canSend ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="recap-address" className="text-sm font-medium">
            {t("recap.label")}
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
              className="min-w-0 flex-[1_1_220px]"
            />
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? t("recap.saving") : t("recap.submit")}
            </Button>
          </div>
          <p className="text-[14px] text-muted">{t("recap.hint")}</p>
        </form>
      ) : (
        <p className="text-[14.5px] leading-normal text-text-2">
          {recap.status === "pending"
            ? t("recap.pending", { email: recap.email ?? "" })
            : recap.status === "sent"
              ? t("recap.sent")
              : t("recap.failed")}{" "}
          {recap.canSend && (
            <button
              type="button"
              className="cursor-pointer font-medium text-text underline underline-offset-2 hover:text-accent-strong"
              onClick={() => {
                setEmail(recap.email ?? "");
                setEditing(true);
              }}
            >
              {recap.status === "failed" ? t("common.tryAgain") : t("recap.another")}
            </button>
          )}
        </p>
      )}
      {error && <p className="text-sm text-accent-strong" role="alert">{error}</p>}
    </div>
  );
}
