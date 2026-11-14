"use client";

import type { SessionState, SessionTicket } from "@tapry/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar, Button, Field, Input, Notice, RecDot, StatusDot } from "@/components/ui";
import { apiFetch, ApiRequestError, loadTicketForInvite, saveTicket } from "@/lib/client/api";
import { getPipeline } from "@/lib/client/recording";
import { errorText, useT } from "@/lib/i18n/client";

const RETRY_MS = 5_000;

export function JoinForm({
  inviteCode,
  hostName,
  consentText,
  consentHash,
}: {
  inviteCode: string;
  hostName: string;
  /** The studio's consent text, exactly as agreed to, and its SHA-256 (sent along, checked by the server). */
  consentText: string;
  consentHash: string;
}) {
  const router = useRouter();
  const { locale, t } = useT();
  const [error, setError] = useState<string | null>(null);
  const [waitingForHost, setWaitingForHost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [previous, setPrevious] = useState<{ ticket: SessionTicket; name: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);

  // Upload anything a crashed or closed tab left behind, as early as possible.
  useEffect(() => void getPipeline(), []);

  // Already joined from this browser? Offer to continue instead of taking another seat.
  useEffect(() => {
    const ticket = loadTicketForInvite(inviteCode);
    if (!ticket) return;
    apiFetch<SessionState>(`/sessions/${ticket.sessionId}/state`, { token: ticket.token })
      .then((state) => {
        const me = state.participants.find((p) => p.id === ticket.participantId);
        if (state.session.status === "open" && me) setPrevious({ ticket, name: me.displayName });
      })
      .catch(() => {});
  }, [inviteCode]);

  // The host hasn't opened the studio yet: try again by ourselves until they do.
  useEffect(() => {
    if (!waitingForHost) return;
    const id = setTimeout(() => form.current?.requestSubmit(), RETRY_MS);
    return () => clearTimeout(id);
  }, [waitingForHost, busy]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const ticket = await apiFetch<SessionTicket>("/join", {
        body: { inviteCode, displayName: data.get("displayName"), consent: data.get("consent") === "on", consentHash, locale },
      });
      saveTicket(ticket, inviteCode);
      router.push(`/session/${ticket.sessionId}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "host_not_here") setWaitingForHost(true);
      else if (err instanceof ApiRequestError && err.code === "consent_changed") {
        // Show the new text (the page renders it on the server) and ask again.
        setWaitingForHost(false);
        setConsent(false);
        setError(errorText(err, locale, t("error.generic")));
        router.refresh();
      } else {
        setWaitingForHost(false);
        setError(errorText(err, locale, t("error.generic")));
      }
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {previous && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5">
          <p className="flex items-center gap-2.5 text-[14.5px] text-text-2">
            <Avatar name={previous.name} className="size-6 text-[11px]" />
            {t("join.already", { name: previous.name })}
          </p>
          <Button variant="record" onClick={() => router.push(`/session/${previous.ticket.sessionId}`)}>
            <RecDot />
            {t("join.continueAs", { name: previous.name })}
          </Button>
        </div>
      )}
      {waitingForHost && (
        <Notice tone="warn" className="flex items-start gap-2.5">
          <StatusDot tone="warn" className="mt-1.5 animate-rec-pulse" />
          <span>{t("join.waitingHost", { host: hostName })}</span>
        </Notice>
      )}
      <form ref={form} onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("common.yourName")} hint={t("join.nameHint", { host: hostName })}>
          <Input name="displayName" autoComplete="name" required maxLength={60} autoFocus={!previous} />
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5 text-[14.5px] leading-[1.45] text-text-2">
          <input
            type="checkbox"
            name="consent"
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="whitespace-pre-line" data-testid="consent-text">
            {consentText}
          </span>
        </label>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant={previous ? "secondary" : "primary"} disabled={busy && !waitingForHost} className="w-full">
          {previous ? t("join.asNew") : t("common.continue")}
        </Button>
      </form>
    </div>
  );
}
