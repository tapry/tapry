#!/usr/bin/env node
// Starts a throwaway SeaweedFS (S3 API on 127.0.0.1:18433), runs the given command
// with S3_E2E_* env vars pointing at it, then shuts SeaweedFS down and deletes its data.
//
//   WEED_BIN=/path/to/weed node scripts/with-seaweedfs.mjs vitest run test/e2e-s3.test.ts
//
// Get `weed` from https://github.com/seaweedfs/seaweedfs/releases (or `brew install seaweedfs`).
//
// With LIVEKIT_BIN set, also starts a throwaway LiveKit server (ws://127.0.0.1:17880) and
// sets LIVEKIT_E2E_URL / _API_KEY / _API_SECRET, so the live call can be tested too.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

// SeaweedFS also listens on port+10000 for gRPC; 18433 avoids a dev instance on 8333 (gRPC 18333).
const S3_PORT = 18433;
const ACCESS_KEY = "opentake";
const SECRET_KEY = "opentake-e2e-secret";
const weed = process.env.WEED_BIN ?? "weed";

const dir = mkdtempSync(join(tmpdir(), "opentake-seaweedfs-"));
mkdirSync(join(dir, "data"));
const s3Config = join(dir, "s3.json");
writeFileSync(
  s3Config,
  JSON.stringify({
    identities: [
      {
        name: "opentake",
        credentials: [{ accessKey: ACCESS_KEY, secretKey: SECRET_KEY }],
        actions: ["Admin", "Read", "List", "Tagging", "Write"],
      },
    ],
  }),
);

const server = spawn(
  weed,
  [
    "server",
    `-dir=${join(dir, "data")}`,
    "-ip=127.0.0.1",
    "-ip.bind=127.0.0.1",
    "-master.port=19333",
    "-volume.port=18080",
    "-filer",
    "-filer.port=18888",
    "-s3",
    `-s3.port=${S3_PORT}`,
    `-s3.config=${s3Config}`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
server.on("error", (err) => {
  console.error(`Could not start SeaweedFS (${weed}): ${err.message}. Set WEED_BIN.`);
  process.exit(1);
});

// ── Optional LiveKit ─────────────────────────────────────────────────────────
const LIVEKIT_PORT = 17880;

/** The first non-loopback IPv4 address (Wi-Fi / Ethernet), or loopback when there is none. */
function mediaAddress() {
  const all = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? []).filter((a) => a.family === "IPv4" && !a.internal).map((a) => ({ name, address: a.address })),
  );
  return (all.find((a) => /^(en|eth|wl)/.test(a.name)) ?? all[0])?.address ?? "127.0.0.1";
}
const LIVEKIT_KEY = "e2ekey";
const LIVEKIT_SECRET = "e2e-livekit-secret-of-at-least-32-chars";
let livekit = null;
if (process.env.LIVEKIT_BIN) {
  const config = join(dir, "livekit.yaml");
  writeFileSync(
    config,
    [
      `port: ${LIVEKIT_PORT}`,
      "bind_addresses: [127.0.0.1]",
      "rtc:",
      "  tcp_port: 17881",
      "  udp_port: 17882",
      // Media on this machine's network address, like a real server: Firefox doesn't use
      // loopback ICE candidates. (Signalling stays on 127.0.0.1.)
      `  node_ip: ${mediaAddress()}`,
      "  use_external_ip: false",
      "keys:",
      `  ${LIVEKIT_KEY}: ${LIVEKIT_SECRET}`,
      "logging:",
      "  level: warn",
    ].join("\n"),
  );
  livekit = spawn(process.env.LIVEKIT_BIN, ["--config", config], { stdio: ["ignore", "pipe", "pipe"] });
  livekit.stdout.on("data", (d) => (log += d));
  livekit.stderr.on("data", (d) => (log += d));
}

let cleanedUp = false;
const cleanup = () => {
  if (cleanedUp) return;
  cleanedUp = true;
  livekit?.kill("SIGTERM");
  server.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
};
// Never leave SeaweedFS running: it holds the ports and the next run fails.
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1));
  });
}

async function waitForS3() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try {
      // Any HTTP answer (even 403) means the S3 gateway is up.
      await fetch(`http://127.0.0.1:${S3_PORT}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.error("SeaweedFS did not start:\n" + log.slice(-4000));
  cleanup();
  process.exit(1);
}

await waitForS3();
if (livekit) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${LIVEKIT_PORT}/`)).ok) break;
    } catch {}
    if (Date.now() > deadline || livekit.exitCode !== null) {
      console.error("LiveKit did not start:\n" + log.slice(-4000));
      cleanup();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}
// The S3 port answers before the filer has volumes ready; give it a moment.
await new Promise((r) => setTimeout(r, 2000));

const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    S3_E2E_ENDPOINT: `http://127.0.0.1:${S3_PORT}`,
    S3_E2E_ACCESS_KEY_ID: ACCESS_KEY,
    S3_E2E_SECRET_ACCESS_KEY: SECRET_KEY,
    ...(livekit && {
      LIVEKIT_E2E_URL: `ws://127.0.0.1:${LIVEKIT_PORT}`,
      LIVEKIT_E2E_API_KEY: LIVEKIT_KEY,
      LIVEKIT_E2E_API_SECRET: LIVEKIT_SECRET,
    }),
  },
});
child.on("exit", (code) => {
  if (code !== 0 && process.env.SHOW_WEED_LOG) console.error(log.slice(-8000));
  // Wait for SeaweedFS to really exit, so a run started right after finds its ports free.
  const force = setTimeout(() => server.kill("SIGKILL"), 10_000);
  livekit?.kill("SIGTERM");
  server.once("exit", () => {
    clearTimeout(force);
    cleanup();
    process.exit(code ?? 1);
  });
  server.kill("SIGTERM");
});
