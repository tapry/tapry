"use client";

import type { SessionTicket } from "@tapry/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { apiFetch, ApiRequestError, saveTicket } from "@/lib/client/api";
import { getPipeline } from "@/lib/client/recording";

export function SoloForm({ code, hostName, consentText, consentHash }: { code: string; hostName: string; consentText: string; consentHash: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);

  // Upload anything a crashed or closed tab left behind, as early as possible.
  useEffect(() => void getPipeline(), []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const ticket = await apiFetch<SessionTicket>("/solo", { body: { code, displayName: data.get("displayName"), consent: data.get("consent") === "on", consentHash } });
      saveTicket(ticket);
      router.push(`/session/${ticket.sessionId}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "consent_changed") {
        setConsent(false);
        router.refresh();
      }
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Your name" hint={`${hostName} will see this with your recording.`}>
        <Input name="displayName" autoComplete="name" required maxLength={60} autoFocus />
      </Field>
      <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-[1.45] text-text-2">
        <input type="checkbox" name="consent" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 shrink-0" />
        <span className="whitespace-pre-line" data-testid="consent-text">
          {consentText}
        </span>
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" disabled={busy} className="w-full">
        Continue
      </Button>
    </form>
  );
}
