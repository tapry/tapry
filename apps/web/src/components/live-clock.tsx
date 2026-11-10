"use client";

import { useEffect, useState } from "react";
import { shortClock } from "@/lib/format";

/**
 * A running recording's length, ticking. The first render uses the server's time (so the page
 * hydrates without a mismatch); after that it follows this device's clock, corrected by how far
 * it was from the server's when the page arrived.
 */
export function LiveClock({ startedAt, serverNow, className }: { startedAt: number; serverNow: number; className?: string }) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const offset = serverNow - Date.now();
    const tick = () => setNow(Date.now() + offset);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [serverNow]);
  return (
    <span className={className} suppressHydrationWarning>
      {shortClock(now - startedAt)}
    </span>
  );
}
