// A live recorder holds a Web Lock on its track so that crash recovery in
// another tab can tell "tab died mid-recording" from "still recording over there".

export function trackLockName(sessionId: string, trackId: string) {
  // Named before the rename to Tapry: an older tab still recording must see the same lock.
  return `opentake:track:${sessionId}:${trackId}`;
}

/** Acquires the lock and resolves with a release function. No-op where Web Locks are missing. */
export function holdLock(name: string): Promise<() => void> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return Promise.resolve(() => {});
  return new Promise((acquired) => {
    void locks.request(name, () => new Promise<void>((release) => acquired(release)));
  });
}

export async function isLockHeld(name: string): Promise<boolean> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return false;
  const { held = [] } = await locks.query();
  return held.some((l) => l.name === name);
}
