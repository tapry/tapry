// TURN over TLS on 443: a call between two people whose browsers may only use relayed
// connections, with 443 the only way in. Runs against the Docker stack:
//   cd deploy/compose && docker compose -f docker-compose.yml -f docker-compose.turn-test.yml up -d
//   E2E_BASE_URL=http://localhost E2E_TURN=1 pnpm exec playwright test turn.spec.ts --project chromium
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { createStudio, expect, signInHost, test } from "./fixtures";

test.skip(!process.env.E2E_TURN, "needs the Docker stack with TURN (E2E_TURN=1)");
test.skip(({ browserName }) => browserName !== "chromium", "Chromium only");
// Caddy's internal certificate for turn.localhost isn't publicly trusted; on a real server
// it's a Let's Encrypt certificate and this flag isn't needed.
// E2E_CHROMIUM_ARGS (a JSON array) adds flags, e.g. --host-resolver-rules to reach a test server.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--ignore-certificate-errors",
      ...(process.env.E2E_CHROMIUM_ARGS ? (JSON.parse(process.env.E2E_CHROMIUM_ARGS) as string[]) : []),
    ],
  },
});

/**
 * Keep every RTCPeerConnection the page creates (to read its connection stats later), and log
 * the TURN servers it was given and every ICE error, so a failure says why.
 */
async function recordPeerConnections(page: Page) {
  await page.addInitScript(() => {
    const Original = window.RTCPeerConnection;
    const all: RTCPeerConnection[] = [];
    const log: string[] = [];
    Object.assign(window, { __pcs: all, __iceLog: log });
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super(config);
        all.push(this);
        log.push(`pc ${all.length}: policy=${config?.iceTransportPolicy ?? "all"} servers=${JSON.stringify((config?.iceServers ?? []).map((s) => s.urls))}`);
        this.addEventListener("icecandidateerror", (e) => {
          const err = e as RTCPeerConnectionIceErrorEvent;
          log.push(`pc ${all.indexOf(this) + 1}: ice error ${err.errorCode} ${err.errorText} url=${err.url}`);
        });
        this.addEventListener("icecandidate", (e) => {
          if (e.candidate) log.push(`pc ${all.indexOf(this) + 1}: candidate ${e.candidate.type} ${e.candidate.protocol} ${e.candidate.address}:${e.candidate.port}`);
        });
      }
    } as typeof RTCPeerConnection;
  });
}

const iceLog = (page: Page) => page.evaluate(() => (window as unknown as { __iceLog: string[] }).__iceLog.join("\n"));

/** The local side of each active (selected) ICE candidate pair: its type and relay protocol. */
const activeCandidates = (page: Page) =>
  page.evaluate(async () => {
    const out: Array<{ type: string; relayProtocol?: string; url?: string }> = [];
    for (const pc of (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs) {
      if (pc.connectionState !== "connected") continue;
      const stats = await pc.getStats();
      stats.forEach((s) => {
        if (s.type !== "transport" || !s.selectedCandidatePairId) return;
        const pair = stats.get(s.selectedCandidatePairId);
        const local = pair && stats.get(pair.localCandidateId);
        if (local) out.push({ type: local.candidateType, relayProtocol: local.relayProtocol, url: local.url });
      });
    }
    return out;
  });

test("a relay-only call connects through TURN over TLS on port 443", async ({ page: host, browser }) => {
  await recordPeerConnections(host);
  await signInHost(host);
  const { inviteUrl } = await createStudio(host, `TURN ${randomBytes(2).toString("hex")}`);
  await host.getByRole("button", { name: "Enter studio" }).click();
  await host.waitForURL(/\/session\//);
  const sessionUrl = `${host.url()}?relay=1`;
  await host.goto(sessionUrl);
  await host.getByRole("button", { name: "Enter the studio" }).click({ timeout: 20_000 });

  const guestContext = await browser.newContext({ permissions: ["camera", "microphone"] });
  const guest = await guestContext.newPage();
  await recordPeerConnections(guest);
  await guest.goto(inviteUrl);
  await guest.getByLabel("Your name").fill("Relay Guest");
  await guest.getByRole("checkbox").check();
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.waitForURL(/\/session\//);
  await guest.goto(sessionUrl);
  await guest.getByRole("button", { name: "Join the studio" }).click({ timeout: 20_000 });

  try {
    for (const p of [host, guest]) await expect(p.getByTestId("call-status")).toHaveText(/Call: connected/, { timeout: 30_000 });
  } catch (err) {
    await test.info().attach("ice-host.txt", { body: await iceLog(host) });
    await test.info().attach("ice-guest.txt", { body: await iceLog(guest) });
    console.log("[turn] host ICE log:\n" + (await iceLog(host)));
    throw err;
  }
  // Media really flows: the guest sees the host's camera.
  const hostTile = guest.locator('[data-testid="remote-tile"][data-name="Dev Host"] video');
  await expect.poll(() => hostTile.evaluate((v) => (v as HTMLVideoElement).videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);

  // And it flows through the relay, over TLS, on 443.
  for (const p of [host, guest]) {
    const active = await activeCandidates(p);
    console.log(`[turn] ${p === host ? "host" : "guest"} active connections:`, JSON.stringify(active));
    expect(active.length, "connected peer connections").toBeGreaterThan(0);
    for (const c of active) {
      expect(c).toMatchObject({ type: "relay", relayProtocol: "tls" });
      expect(c.url ?? "").toMatch(/^turns:turn\.[^:]+:443/);
    }
  }
  await guestContext.close();
});
