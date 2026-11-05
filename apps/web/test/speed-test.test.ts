import { describe, expect, it } from "vitest";
import { uploadVerdicts } from "../src/lib/client/tech-check";
import { PUBLIC_SPEED_TEST_BYTES_PER_MINUTE, SpeedTestLimiter, clientAddress } from "../src/server/speed-test";
import { createServer } from "./harness";

const MB = 1024 * 1024;

describe("public upload-speed test (server)", () => {
  async function server(origins: string[] = []) {
    const s = await createServer(undefined, { speedTestOrigins: origins });
    const post = (bytes: number, headers: Record<string, string> = {}) =>
      s.fetchFor()("https://app.test/api/speed-test", { method: "POST", body: new Uint8Array(bytes), headers: { "x-forwarded-for": "203.0.113.7", ...headers } });
    return { ...s, post };
  }

  it("reads and drops test data, no account needed, at most 8 MB a request", async () => {
    const s = await server();
    const ok = await s.post(MB);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ bytes: MB });
    expect((await s.post(8 * MB + 1)).status).toBe(413);
  });

  it("limits each address to 64 MB a minute, then lets it go again", async () => {
    const s = await server();
    for (let sent = 0; sent < PUBLIC_SPEED_TEST_BYTES_PER_MINUTE; sent += 8 * MB) expect((await s.post(8 * MB)).status).toBe(200);
    expect((await s.post(MB)).status).toBe(429);
    expect((await s.post(MB, { "x-forwarded-for": "198.51.100.2" })).status).toBe(200); // someone else
    s.tick(61_000);
    expect((await s.post(MB)).status).toBe(200);
  });

  it("lets only the listed sites read the answer from their pages (CORS)", async () => {
    const s = await server(["https://tapry.test"]);
    const allowed = await s.post(MB, { origin: "https://tapry.test" });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://tapry.test");
    const other = await s.post(MB, { origin: "https://elsewhere.test" });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await s.fetchFor()("https://app.test/api/speed-test", {
      method: "OPTIONS",
      headers: { origin: "https://tapry.test", "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    // Over the limit, the listed site still gets a readable answer.
    const limited = await server(["https://tapry.test"]);
    for (let sent = 0; sent < PUBLIC_SPEED_TEST_BYTES_PER_MINUTE; sent += 8 * MB) await limited.post(8 * MB);
    const slow = await limited.post(MB, { origin: "https://tapry.test" });
    expect(slow.status).toBe(429);
    expect(slow.headers.get("access-control-allow-origin")).toBe("https://tapry.test");
  });
});

describe("speed-test pieces", () => {
  it("keeps a sliding minute per address", () => {
    let now = 0;
    const limiter = new SpeedTestLimiter(10, () => now);
    limiter.record("a", 6);
    expect(limiter.remaining("a")).toBe(4);
    expect(limiter.remaining("b")).toBe(10);
    now = 60_001;
    expect(limiter.remaining("a")).toBe(10);
  });

  it("takes the address our proxy added, not one the visitor made up", () => {
    const req = (xff?: string) => new Request("https://app.test/", { headers: xff ? { "x-forwarded-for": xff } : {} });
    expect(clientAddress(req("6.6.6.6, 203.0.113.7"))).toBe("203.0.113.7");
    expect(clientAddress(req())).toBe("direct");
  });

  it("says which kinds of studio a line keeps up with", () => {
    expect(uploadVerdicts(3).map((v) => [v.kind, v.ok])).toEqual([
      ["Sound only", true],
      ["Standard video (720p)", false],
      ["Full HD video (1080p)", false],
    ]);
    expect(uploadVerdicts(12).every((v) => v.ok)).toBe(true);
  });
});
