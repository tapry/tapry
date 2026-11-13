"use client";

// Shown on every dashboard page while an account still has to confirm its address
// (Tapry Cloud): what to do, and a way to get the email again.
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Button, Notice } from "./ui";

export function ConfirmEmailNotice({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setState("sending");
    setError(null);
    try {
      await apiFetch("/auth/verify/send", { body: {} });
      setState("sent");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setState("idle");
    }
  };

  return (
    <Notice tone="warn" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2" data-testid="confirm-email">
      <span className="min-w-0 flex-[1_1_320px]">
        <strong className="font-medium">Confirm your email to start recording.</strong> We sent a link to <span className="break-all">{email}</span>. Until you open it, you can&apos;t create or open a
        studio.
        {error && <span className="mt-1 block">{error}</span>}
      </span>
      {state === "sent" ? (
        <span data-testid="confirm-email-sent">Sent. Look in your inbox and spam folder.</span>
      ) : (
        <Button type="button" variant="secondary" size="sm" disabled={state === "sending"} onClick={send}>
          {state === "sending" ? "Sending…" : "Send it again"}
        </Button>
      )}
    </Notice>
  );
}
