"use client";

/**
 * One tab per session in a browser: two would record the same person twice, and their tracks get
 * mixed together. Calls `onWaiting` if another tab has it, `onHeld` once this one does (at once,
 * or when the other closes or crashes). Returns a function that lets go. Browsers without Web
 * Locks go ahead.
 */
export function holdSessionLock(sessionId: string, onHeld: () => void, onWaiting: () => void): () => void {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) {
    onHeld();
    return () => {};
  }
  const name = `tapry:session:${sessionId}`;
  const giveUp = new AbortController();
  let release = () => {};
  let cancelled = false;
  const hold = () =>
    new Promise<void>((resolve) => {
      // Let go before the lock arrived (React re-running the effect): don't keep it forever.
      if (cancelled) return resolve();
      release = resolve;
      onHeld();
    });
  void locks
    .request(name, { ifAvailable: true }, async (lock) => {
      if (lock) return hold();
      if (!cancelled) onWaiting();
      await locks.request(name, { signal: giveUp.signal }, hold).catch(() => {}); // given up on: nothing to do
    })
    .catch((err) => {
      console.error("[session-lock]", err);
      onHeld(); // never let this keep anyone out of recording
    });
  return () => {
    cancelled = true;
    giveUp.abort();
    release();
  };
}
