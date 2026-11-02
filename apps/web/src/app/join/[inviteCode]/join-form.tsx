"use client";

import type { SessionState, SessionTicket } from "@tapry/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, cn, Field, Input, Notice, StatusDot } from "@/components/ui";
import { apiFetch, ApiRequestError, loadTicketForInvite, saveTicket } from "@/lib/client/api";
import { getPipeline } from "@/lib/client/recording";

const RETRY_MS = 5_000;

export function JoinForm({
  inviteCode,
  hostName,
  consentText,
  consentHash,
}: {
  inviteCode: string;
  hostName: string;
  /** The show's consent text, exactly as agreed to, and its SHA-256 (sent along, checked by the server). */
  consentText: string;
  consentHash: string;
}) {
  const router = useRouter();
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
        body: { inviteCode, displayName: data.get("displayName"), consent: data.get("consent") === "on", consentHash },
      });
      saveTicket(ticket, inviteCode);
      router.push(`/session/${ticket.sessionId}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "host_not_here") setWaitingForHost(true);
      else if (err instanceof ApiRequestError && err.code === "consent_changed") {
        // Show the new text (the page renders it on the server) and ask again.
        setWaitingForHost(false);
        setConsent(false);
        setError(err.message);
        router.refresh();
      } else {
        setWaitingForHost(false);
        setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      }
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[22px]">
      {previous && (
        <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-4">
          <p className="text-[15px]">You already joined this session as {previous.name}.</p>
          <Button variant="record" onClick={() => router.push(`/session/${previous.ticket.sessionId}`)}>
            Continue as {previous.name}
          </Button>
        </div>
      )}
      {waitingForHost && (
        <Notice tone="warn" className="flex items-start gap-2.5">
          <StatusDot tone="warn" className="mt-1.5 animate-rec-pulse" />
          <span>
            {hostName} hasn&apos;t opened the studio yet. Keep this page open, and we&apos;ll try again for you every few
            seconds.
          </span>
        </Notice>
      )}
      <form ref={form} onSubmit={submit} className="flex flex-col gap-[22px]">
        <Field label="Your name" hint={`${hostName} and the other guests will see this.`}>
          <Input name="displayName" autoComplete="name" required maxLength={60} autoFocus={!previous} />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-2 px-4 py-3.5 text-[15px] leading-normal">
          <input
            type="checkbox"
            name="consent"
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-[3px] size-[18px] shrink-0"
          />
          <span className="whitespace-pre-line" data-testid="consent-text">
            {consentText}
          </span>
        </label>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button
          type="submit"
          variant="record"
          size="lg"
          disabled={busy && !waitingForHost}
          className={cn("w-full text-[17px]", !consent && "opacity-60 shadow-none")}
        >
          {previous ? "Join as someone new" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
