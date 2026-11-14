// The screen is kept on while someone is in a session: on a phone, a locked screen stops the
// recording. The browser drops the lock when the page is hidden, so it must be asked for again.
import { describe, expect, it } from "vitest";
import { keepAwake, type WakeEnv } from "../src/lib/client/wake-lock";

function fakeEnv(opts: { refuse?: boolean } = {}) {
  let visible = true;
  const listeners = new Set<() => void>();
  const log: string[] = [];
  const env: WakeEnv = {
    request: async () => {
      if (opts.refuse) throw new Error("NotAllowedError");
      log.push("request");
      return { release: async () => void log.push("release") };
    },
    visible: () => visible,
    onVisible: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const show = (v: boolean) => {
    visible = v;
    if (v) for (const fn of listeners) fn();
  };
  return { env, log, show, listeners };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("keeping the screen on", () => {
  it("asks once, asks again when the page comes back, and lets go at the end", async () => {
    const f = fakeEnv();
    const stop = keepAwake(f.env);
    await settle();
    expect(f.log).toEqual(["request"]);
    f.show(false); // the browser releases it by itself here
    f.show(true);
    await settle();
    expect(f.log).toEqual(["request", "request"]);
    stop();
    await settle();
    expect(f.log).toEqual(["request", "request", "release"]);
    expect(f.listeners.size).toBe(0);
    f.show(true);
    await settle();
    expect(f.log).toHaveLength(3);
  });

  it("doesn't ask while hidden, and releases a lock that arrives after it was stopped", async () => {
    const f = fakeEnv();
    f.show(false);
    const stop = keepAwake(f.env);
    await settle();
    expect(f.log).toEqual([]);
    f.show(true); // asked now…
    stop(); // …and stopped before the browser answered
    await settle();
    expect(f.log).toEqual(["request", "release"]);
  });

  it("is harmless where the browser has no wake lock or refuses it", async () => {
    expect(() => keepAwake(null)()).not.toThrow();
    const f = fakeEnv({ refuse: true });
    const stop = keepAwake(f.env);
    await settle();
    f.show(true);
    await settle();
    expect(() => stop()).not.toThrow();
  });
});
