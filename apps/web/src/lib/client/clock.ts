// NTP-style clock offset estimate against /api/time. Will move to packages/sync
// together with the post-recording alignment code.

/**
 * This device's clock for everything compared with the server: the steady clock the browser
 * started at page load, unlike Date.now() unaffected by the system clock being adjusted (NTP,
 * waking from sleep) during a session. The offset estimate is measured on it too.
 */
export const localNow = () => performance.timeOrigin + performance.now();

export interface ClockEstimate {
  /** Add to localNow() to get server time. */
  offsetMs: number;
  /** Round trip of the best (lowest-latency) sample. */
  rttMs: number;
  samples: number;
}

/**
 * Takes `samples` round trips and keeps the one with the smallest RTT: its midpoint is
 * the least affected by queuing delay, so its offset estimate is the most accurate.
 */
export async function estimateClock(
  fetchServerTime: () => Promise<number>,
  opts: { samples?: number; now?: () => number } = {},
): Promise<ClockEstimate> {
  const now = opts.now ?? localNow;
  const n = opts.samples ?? 5;
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < n; i++) {
    const t0 = now();
    const server = await fetchServerTime();
    const t1 = now();
    const rtt = t1 - t0;
    const offset = server - (t0 + rtt / 2);
    if (!best || rtt < best.rtt) best = { rtt, offset };
  }
  if (!best) throw new Error("estimateClock needs at least one sample");
  return { offsetMs: Math.round(best.offset), rttMs: Math.round(best.rtt), samples: n };
}
