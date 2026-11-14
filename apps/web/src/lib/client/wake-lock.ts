// Keeps the screen on while someone is in a session. A phone that dims and locks stops the
// camera, the microphone and the upload with it; a laptop that sleeps does the same. The
// browser drops the lock whenever the page is hidden, so it is asked for again each time the
// page comes back. Where the browser has no Wake Lock this does nothing, and the room says so
// on phones.

interface Sentinel {
  release(): Promise<void>;
}

export interface WakeEnv {
  /** Ask the browser to keep the screen on. Rejects when it won't (battery saver, hidden page). */
  request(): Promise<Sentinel>;
  visible(): boolean;
  /** Calls `fn` each time the page becomes visible; returns how to stop. */
  onVisible(fn: () => void): () => void;
}

export function wakeLockSupported() {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

function browserEnv(): WakeEnv | null {
  if (!wakeLockSupported() || typeof document === "undefined") return null;
  return {
    request: () => (navigator as Navigator & { wakeLock: { request(type: "screen"): Promise<Sentinel> } }).wakeLock.request("screen"),
    visible: () => document.visibilityState === "visible",
    onVisible: (fn) => {
      const on = () => {
        if (document.visibilityState === "visible") fn();
      };
      document.addEventListener("visibilitychange", on);
      return () => document.removeEventListener("visibilitychange", on);
    },
  };
}

/** Holds the screen on until the returned function is called. Never throws: it is a help, not a need. */
export function keepAwake(env: WakeEnv | null = browserEnv()): () => void {
  if (!env) return () => {};
  let stopped = false;
  let held: Sentinel | null = null;
  let asking = false;
  const ask = () => {
    if (stopped || asking || !env.visible()) return;
    asking = true;
    env
      .request()
      .then((s) => {
        // The one from before the page was hidden is already released by the browser.
        held = s;
        if (stopped) void s.release().catch(() => {});
      })
      .catch(() => {})
      .finally(() => {
        asking = false;
      });
  };
  ask();
  const off = env.onVisible(ask);
  return () => {
    stopped = true;
    off();
    void held?.release().catch(() => {});
    held = null;
  };
}

/** A phone or tablet: touch is the main way in, and there is no hover. */
export function isTouchDevice() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse) and (hover: none)").matches;
}
