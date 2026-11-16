// Call diagnostics: which browsers share one camera capture between copies, how a device is
// named in the log, and the endpoint that writes a device's technical events to the log.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAppleWebKit, receivedVideoLine, sentVideoLine } from "../src/lib/client/diag";
import { setup } from "./harness";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  iphoneEdge: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/131.0 Mobile/15E148 Safari/604.1",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  macEdge: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
};

describe("which browsers share one camera between copies", () => {
  it("every browser on an iPhone, and Safari on a Mac", () => {
    expect(isAppleWebKit(UA.iphoneSafari)).toBe(true);
    expect(isAppleWebKit(UA.iphoneChrome)).toBe(true); // Chrome on an iPhone is WebKit underneath
    expect(isAppleWebKit(UA.iphoneEdge)).toBe(true);
    expect(isAppleWebKit(UA.macSafari)).toBe(true);
    expect(isAppleWebKit(UA.macSafari, 5)).toBe(true); // an iPad that says it is a Mac
  });
  it("not Chrome, Edge or Firefox elsewhere", () => {
    for (const ua of [UA.macChrome, UA.macEdge, UA.androidChrome, UA.firefox]) expect(isAppleWebKit(ua)).toBe(false);
  });
});

describe("what a picture sends and receives, as one line for the log", () => {
  const stats = (...entries: Array<Record<string, unknown>>) => ({ getStats: async () => new Map(entries.map((e, i) => [String(i), e])) });
  it("says the size, the rate, the codec and what holds the encoder back", async () => {
    const sender = stats(
      { type: "outbound-rtp", kind: "video", codecId: "c1", frameWidth: 360, frameHeight: 640, framesPerSecond: 3.4, framesEncoded: 120, framesSent: 118, encoderImplementation: "libvpx", qualityLimitationReason: "cpu", bytesSent: 204_800 },
      { type: "codec", id: "c1", mimeType: "video/VP8" },
    );
    expect(await sentVideoLine(sender as unknown as RTCRtpSender)).toBe("360x640 at 3 fps, 120 encoded, 118 sent, VP8, libvpx, limited by cpu, 200 KB");
    expect(await sentVideoLine(undefined)).toBe("no sender");
    expect(await sentVideoLine(stats() as unknown as RTCRtpSender)).toBe("nothing sent yet");
  });
  it("says how many frames arrived and were shown, and gives the count to notice one that stopped", async () => {
    const receiver = stats({ type: "inbound-rtp", kind: "video", codecId: "c", frameWidth: 360, frameHeight: 640, framesPerSecond: 0, framesReceived: 80, framesDecoded: 79, framesDropped: 1, packetsLost: 12, freezeCount: 2 });
    expect(await receivedVideoLine(receiver as unknown as RTCRtpReceiver)).toEqual({
      decoded: 79,
      line: "360x640 at 0 fps, 80 received, 79 decoded, 1 dropped, 12 lost, 2 freezes, ?, ?",
    });
  });
});

describe("a device's call diagnostics", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    t = await setup();
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());
  const lines = () => log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[diag]"));
  /** As the guest (the harness sends their token); `null` sends none. */
  const send = (events: unknown, token?: null) => t.call(`/sessions/${t.sessionId}/diag`, { events }, ...(token === null ? [null] : []));

  it("go to the log, one line an event, with who and when", async () => {
    const res = await send([
      { code: "call.video_publish_failed", detail: "try 1, 10012 ms: ConnectionError: publication of local track timed out", atMs: 15_300 },
      { code: "camera.muted_by_browser", atMs: 16_000 },
    ]);
    expect(res.status).toBe(204);
    expect(lines()).toEqual([
      expect.stringMatching(new RegExp(`^\\[diag\\] ${t.sessionId} par_\\S+ guest \\+15\\.3s call\\.video_publish_failed: try 1, 10012 ms: ConnectionError: publication`)),
      expect.stringMatching(/guest \+16\.0s camera\.muted_by_browser$/),
    ]);
  });

  it("can't break a log line, and need a participant's token", async () => {
    await send([{ code: "call.failed", detail: "one\ntwo\u0007 [diag] fake", atMs: 1 }]);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).not.toMatch(/[\n\u0007]/);
    expect((await send([{ code: "Not A Code", atMs: 1 }])).status).toBe(400);
    expect((await send([{ code: "call.start", atMs: 1 }], null)).status).toBe(401);
  });

  it("are capped for one person, so a loop can't flood the log", async () => {
    const events = Array.from({ length: 40 }, (_, i) => ({ code: "call.state", atMs: i }));
    for (let i = 0; i < 12; i++) await send(events);
    expect(lines()).toHaveLength(400);
  });
});
