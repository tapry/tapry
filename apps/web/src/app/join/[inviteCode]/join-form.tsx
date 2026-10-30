"use client";

import type { SessionState, SessionTicket } from "@opentake/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { apiFetch, ApiRequestError, loadTicketForInvite, saveTicket } from "@/lib/client/api";
import { getPipeline } from "@/lib/client/recording";

export function JoinForm({ inviteCode }: { inviteCode: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previous, setPrevious] = useState<{ ticket: SessionTicket; name: string } | null>(null);

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

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const ticket = await apiFetch<SessionTicket>("/join", {
        body: { inviteCode, displayName: form.get("displayName"), consent: form.get("consent") === "on" },
      });
      saveTicket(ticket, inviteCode);
      router.push(`/session/${ticket.sessionId}`);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.code === "host_not_here"
            ? "Your host hasn't opened the studio yet. Keep this page open and try again in a moment."
            : err.message
          : "Something went wrong. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-5">
      {previous && (
        <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-4">
          <p className="text-sm">You already joined this session as {previous.name}.</p>
          <Button onClick={() => router.push(`/session/${previous.ticket.sessionId}`)}>Continue as {previous.name}</Button>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name" hint="Shown to the host and other guests.">
          <Input name="displayName" autoComplete="name" required maxLength={60} autoFocus={!previous} />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="consent" required className="mt-0.5 size-4" />
          <span>
            I agree to be recorded. My camera and microphone are recorded on this device and uploaded to the host's
            storage.
          </span>
        </label>
        {error && <Notice tone={error.startsWith("Your host") ? "warn" : "danger"}>{error}</Notice>}
        <Button type="submit" disabled={busy} className="w-full">
          {previous ? "Join as someone new" : "Continue"}
        </Button>
      </form>
    </Card>
  );
}
