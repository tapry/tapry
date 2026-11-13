"use client";

// Paddle's "default payment link" (set in Paddle: Checkout, Checkout settings). Paddle sends people
// here with `?_ptxn=<transaction>`: links on invoices, and the "update your card" links in its own
// subscription emails. Paddle.js opens the right checkout by itself once it is initialised; this
// page only loads it and says what is happening. Paddle's script loads here and on /checkout only.
import { useEffect, useRef, useState } from "react";
import { Notice } from "./ui";
import { Spinner } from "./ui-extra";

interface PaddleJs {
  Environment: { set(env: "sandbox" | "production"): void };
  Initialize(opts: { token: string; eventCallback?: (event: { name?: string }) => void }): void;
}

const SCRIPT = "https://cdn.paddle.com/paddle/v2/paddle.js";

export function PaddlePay({ clientToken, sandbox, hasTransaction }: { clientToken: string; sandbox: boolean; hasTransaction: boolean }) {
  const [state, setState] = useState<"loading" | "open" | "done" | "closed" | "failed" | "refused">(hasTransaction ? "loading" : "closed");
  const started = useRef(false);

  useEffect(() => {
    if (!hasTransaction || started.current) return;
    started.current = true;
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onerror = () => setState("failed");
    script.onload = () => {
      const paddle = (window as unknown as { Paddle?: PaddleJs }).Paddle;
      if (!paddle) return setState("failed");
      try {
        if (sandbox) paddle.Environment.set("sandbox");
        paddle.Initialize({
          token: clientToken,
          eventCallback: (event) => {
            if (event.name === "checkout.loaded") setState("open");
            if (event.name === "checkout.completed") setState("done");
            if (event.name === "checkout.error") setState("refused");
            if (event.name === "checkout.closed") setState((now) => (now === "done" || now === "refused" ? now : "closed"));
          },
        });
      } catch {
        setState("failed");
      }
    };
    document.head.appendChild(script);
  }, [clientToken, sandbox, hasTransaction]);

  if (state === "done") return <Notice tone="ok" data-testid="pay-done">Thank you. The payment went through, and Paddle emails you a receipt.</Notice>;
  if (state === "refused") return <Notice tone="danger" data-testid="pay-refused">The payment provider couldn&apos;t open this payment, and nothing was charged.</Notice>;
  if (state === "failed") return <Notice tone="danger" data-testid="pay-failed">The payment page couldn&apos;t be opened. A blocker in your browser may be stopping it: allow it for this site and reload.</Notice>;
  if (state === "closed") {
    return (
      <Notice data-testid="pay-closed">
        {hasTransaction ? "The payment window was closed. Open the link from your email or invoice again when you're ready." : "This page opens payments from Paddle's emails and invoices. To choose a plan, open Settings, Plan in Tapry."}
      </Notice>
    );
  }
  return (
    <Notice className="flex items-center gap-2" data-testid="pay-opening">
      <Spinner /> {state === "loading" ? "Opening the secure payment window…" : "Paying happens in Paddle's window; no card detail reaches Tapry."}
    </Notice>
  );
}
