"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui";

/** Runs the checks again (the page renders them on the server). */
export function CheckAgain() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" disabled={pending} onClick={() => start(() => router.refresh())}>
      {pending ? "Checking…" : "Check again"}
    </Button>
  );
}

/** Can this browser reach LiveKit? The way guests' browsers reach it, so the answer that matters. */
export function CallProbe({ url }: { url: string }) {
  const [state, setState] = useState<{ ok: boolean; ms: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    // no-cors: only reachability matters here, and it needs nothing from LiveKit's CORS setup.
    fetch(url.replace(/^ws/, "http"), { mode: "no-cors", signal: AbortSignal.timeout(8000) })
      .then(() => !cancelled && setState({ ok: true, ms: Math.round(performance.now() - t0) }))
      .catch(() => !cancelled && setState({ ok: false, ms: 0 }));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <span className={state && !state.ok ? "text-sm text-accent-strong" : "text-sm text-muted"} data-testid="call-probe" data-ok={state ? String(state.ok) : undefined}>
      {!state
        ? "Testing from this browser…"
        : state.ok
          ? `Reachable from this browser (${state.ms} ms)`
          : "Not reachable from this browser: calls won't connect (recording still works). Check the livekit address and the firewall."}
    </span>
  );
}
