"use client";

// Opens Paddle's one-page overlay checkout for exactly one price, with this account's id attached
// so Paddle's webhook can say whose subscription it is, and the signed-in email filled in.
// Paddle's script (@paddle/paddle-js) is loaded here, on /pay and nowhere else in the app: only
// someone buying a plan ever contacts Paddle. Only the public client token reaches the browser;
// the API key stays on the server.
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { useEffect, useRef, useState } from "react";
import { Notice } from "./ui";
import { Spinner } from "./ui-extra";

export function PaddleCheckout({ priceId, clientToken, sandbox, accountId, email }: { priceId: string; clientToken: string; sandbox: boolean; accountId: string; email: string }) {
  const [state, setState] = useState<"loading" | "open" | "closed" | "failed" | "refused">("loading");
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const done = `${window.location.origin}/welcome`;
    initializePaddle({
      token: clientToken,
      environment: sandbox ? "sandbox" : "production",
      eventCallback: (event) => {
        if (event.name === "checkout.completed") window.location.assign(done);
        // Paddle's own refusal: the price or the seller's account can't take payments (yet).
        if (event.name === "checkout.error") setState("refused");
        // Closing its error window doesn't hide what went wrong.
        if (event.name === "checkout.closed") setState((now) => (now === "refused" ? now : "closed"));
      },
    })
      .then((paddle: Paddle | undefined) => {
        if (!paddle) return setState("failed");
        // `user_id` is what the webhook reads back: the account this payment is for.
        paddle.Checkout.open({
          items: [{ priceId, quantity: 1 }],
          customData: { user_id: accountId },
          customer: { email },
          settings: { displayMode: "overlay", variant: "one-page", successUrl: done },
        });
        setState("open");
      })
      .catch(() => setState("failed"));
  }, [priceId, clientToken, sandbox, accountId, email]);

  if (state === "failed") {
    return (
      <Notice tone="danger" data-testid="checkout-failed">
        The checkout couldn&apos;t be opened. A blocker in your browser may be stopping the payment provider&apos;s page: allow it for this site and reload.
      </Notice>
    );
  }
  if (state === "refused") {
    return (
      <Notice tone="danger" data-testid="checkout-refused">
        The payment provider couldn&apos;t start this checkout, and nothing was charged. Plans can&apos;t be bought right now; write to us and we&apos;ll sort it out.
      </Notice>
    );
  }
  if (state === "closed") {
    return (
      <Notice data-testid="checkout-closed">
        The checkout was closed and nothing was charged.{" "}
        <button type="button" className="cursor-pointer font-medium underline underline-offset-[3px]" onClick={() => window.location.reload()}>
          Open it again
        </button>
      </Notice>
    );
  }
  return (
    <Notice className="flex items-center gap-2" data-testid="checkout-opening">
      <Spinner /> {state === "loading" ? "Opening the checkout…" : "The checkout is open. Paying happens on our payment provider's page; no card detail reaches Tapry."}
    </Notice>
  );
}
