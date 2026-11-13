"use client";

// The pricing page's prices, localized by Paddle: the visitor's currency and, where Paddle's tax
// mode includes it, tax. No country is passed: the site is static files with no request headers
// to read, so Paddle works it out from the visitor's IP address. What Paddle returns is shown as
// it is (formattedTotals): nothing here does maths on prices or formats them again.
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { useEffect, useState } from "react";
import { PADDLE_ENVIRONMENT, PADDLE_TOKEN, TIERS } from "@/content/tiers";

/** price id → Paddle's formatted total, for every tier's monthly and yearly price. */
export type Prices = Record<string, string>;

let paddle: Promise<Paddle | undefined> | null = null;

export function usePaddlePrices(): Prices | null {
  const [prices, setPrices] = useState<Prices | null>(null);
  useEffect(() => {
    if (!PADDLE_TOKEN || !PADDLE_ENVIRONMENT) return;
    let gone = false;
    paddle ??= initializePaddle({ token: PADDLE_TOKEN, environment: PADDLE_ENVIRONMENT });
    paddle
      .then((p) => p?.PricePreview({ items: TIERS.flatMap((t) => [t.priceId.month, t.priceId.year]).map((priceId) => ({ priceId, quantity: 1 })) }))
      .then((res) => {
        if (gone || !res) return;
        setPrices(Object.fromEntries(res.data.details.lineItems.map((li) => [li.price.id, li.formattedTotals.total])));
      })
      // Blocked, offline or refused: the page keeps the listed prices.
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, []);
  return prices;
}
