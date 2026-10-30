// NTP-style clock offset estimate against /api/time. Will move to packages/sync
// together with the post-recording alignment code.

export interface ClockEstimate {
  /** Add to Date.now() to get server time. */
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
  const now = opts.now ?? (() => performance.timeOrigin + performance.now());
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
