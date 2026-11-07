import type { TrackInfo } from "@tapry/recorder";
import type { SessionTicket } from "@tapry/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadToken } from "../src/lib/client/recording";
import { followSession, SSE_SILENCE_MS } from "../src/lib/client/session-events";

const ticket = (participantId: string, token: string) => ({ participantId, token }) as SessionTicket;
const track = (meta?: Record<string, string>) => ({ sessionId: "ses", trackId: "trk", meta }) as TrackInfo;

describe("which token a track uploads with", () => {
  it("uses the token it was recorded under, after this browser joined again as someone new", () => {
    expect(uploadToken(ticket("par_new", "new"), track({ participantId: "par_old", token: "old" }))).toBe("old");
    expect(uploadToken(null, track({ participantId: "par_old", token: "old" }))).toBe("old");
  });

  it("uses the current ticket for the same person: a host's token changes when they reopen", () => {
    expect(uploadToken(ticket("par_host", "fresh"), track({ participantId: "par_host", token: "stale" }))).toBe("fresh");
  });

  it("uses the ticket for tracks from before tokens were kept, and needs one of the two", () => {
    expect(uploadToken(ticket("par", "current"), track({ recordingId: "rec" }))).toBe("current");
    expect(() => uploadToken(null, track({ recordingId: "rec" }))).toThrow(/No access/);
  });
});

describe("following a session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reconnects when a connection goes silent, and gets the current state", async () => {
    const enc = new TextEncoder();
    const state = { session: { status: "open" }, recording: { id: "rec_1" } };
    let connections = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        connections++;
        const first = connections === 1;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            // The first connection hangs without a word, like one lost to a sleeping network.
            if (!first) controller.enqueue(enc.encode(`event: state\ndata: ${JSON.stringify(state)}\n\n`));
            init.signal!.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        });
        return new Response(body, { status: 200 });
      }),
    );
    const seen: unknown[] = [];
    const stop = followSession("ses", "token", (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(SSE_SILENCE_MS - 1000);
    expect(connections).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(connections).toBe(2);
    expect(seen).toEqual([state]);
    stop();
  });

  it("keeps a connection that only sends pings", async () => {
    const enc = new TextEncoder();
    let connections = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        connections++;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 15_000);
          },
        });
        return new Response(body, { status: 200 });
      }),
    );
    const stop = followSession("ses", "token", () => {});
    await vi.advanceTimersByTimeAsync(SSE_SILENCE_MS * 4);
    expect(connections).toBe(1);
    stop();
  });
});
