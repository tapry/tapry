#!/usr/bin/env node
// Smoke test of a production build: starts `next start` against real S3 storage and a fresh
// embedded database, then walks the whole flow over HTTP the way the browser will.
//
//   pnpm --filter @opentake/web build
//   WEED_BIN=/path/to/weed node scripts/with-seaweedfs.mjs node scripts/smoke.mjs
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), "opentake-smoke-"));

const server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    DATABASE_URL: `pglite://${join(dataDir, "db")}`,
    S3_ENDPOINT: process.env.S3_E2E_ENDPOINT,
    S3_BUCKET: "opentake-smoke",
    S3_ACCESS_KEY_ID: process.env.S3_E2E_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_E2E_SECRET_ACCESS_KEY,
  },
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

let failed = false;
const step = async (name, fn) => {
  try {
    const result = await fn();
    console.log(`  ✓ ${name}`);
    return result;
  } catch (err) {
    failed = true;
    console.log(`  ✗ ${name}\n    ${err.message}`);
    throw err;
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

let cookie = "";
async function api(method, path, { body, token, expect = [200, 201, 204] } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie && !token) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  assert(expect.includes(res.status), `${method} ${path} → ${res.status} ${text}`);
  return json;
}

/** Opens the SSE stream and returns a function that resolves with the next `state` event. */
async function events(sessionId, token, signal) {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/events`, { headers: { authorization: `Bearer ${token}` }, signal });
  assert(res.ok, `events → ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return async () => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const msg = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const m = /^event: state\ndata: (.*)$/m.exec(msg);
        if (m) return JSON.parse(m[1]);
        continue;
      }
      const { value, done } = await reader.read();
      assert(!done, "event stream ended");
      buffer += decoder.decode(value, { stream: true });
    }
  };
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/time`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("next start did not come up:\n" + log.slice(-3000));
}

const abort = new AbortController();
try {
  console.log("Smoke test against", BASE);
  await step("server starts and answers /api/time", waitForServer);

  await step("first sign-up becomes admin", async () => {
    const { user } = await api("POST", "/api/auth/signup", {
      body: { email: "host@example.com", name: "Host", password: "correct horse battery" },
    });
    assert(user.isAdmin, "first user should be admin");
    assert(cookie.startsWith("ot_session="), "session cookie should be set");
  });

  const studio = await step("host creates a studio", () => api("POST", "/api/studios", { body: { name: "Smoke Show" } }));
  const host = await step("host opens the studio", () => api("POST", `/api/studios/${studio.id}/open`));
  const guest = await step("guest joins with the invite link", () =>
    api("POST", "/api/join", { body: { inviteCode: studio.inviteCode, displayName: "Guest", consent: true } }),
  );

  const nextEvent = await step("guest subscribes to live events", async () => {
    const next = await events(host.sessionId, guest.token, abort.signal);
    const first = await next();
    assert(first.participants.length === 2, `expected 2 participants, got ${first.participants.length}`);
    assert(first.recording === null, "no recording yet");
    return next;
  });

  const recording = await step("host presses Record; guest is told over SSE", async () => {
    const { recording } = await api("POST", `/api/sessions/${host.sessionId}/recordings`, { token: host.token });
    const seen = await nextEvent();
    assert(seen.recording?.id === recording.id && seen.recording.status === "recording", "guest did not see Record");
    return recording;
  });

  const mime = "audio/webm;codecs=opus";
  const { trackId } = await step("guest creates a track", () =>
    api("POST", `/api/sessions/${host.sessionId}/tracks`, {
      token: guest.token,
      body: { recordingId: recording.id, kind: "audio", mimeType: mime, startedAt: recording.startedAt },
    }),
  );

  await step("guest uploads a chunk to storage via a presigned URL and commits it", async () => {
    const data = randomBytes(256 * 1024);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const path = `/api/sessions/${host.sessionId}/tracks/${trackId}/chunks/0`;
    const target = await api("POST", `${path}/upload-url`, { token: guest.token, body: { bytes: data.length, mimeType: mime, sha256 } });
    const put = await fetch(target.url, { method: "PUT", headers: target.headers, body: data });
    assert(put.ok, `storage PUT → ${put.status}`);
    await api("POST", `${path}/commit`, {
      token: guest.token,
      body: { bytes: data.length, sha256, startTs: recording.startedAt, endTs: recording.startedAt + 4000 },
    });
  });

  await step("host presses Stop; guest is told over SSE", async () => {
    await api("POST", `/api/sessions/${host.sessionId}/recordings/${recording.id}/stop`, { token: host.token });
    const seen = await nextEvent();
    assert(seen.recording?.status === "stopped", "guest did not see Stop");
  });

  await step("guest completes the track after Stop", async () => {
    const done = await api("POST", `/api/sessions/${host.sessionId}/tracks/${trackId}/complete`, {
      token: guest.token,
      body: { stoppedAt: Date.now(), lastSeq: 0 },
    });
    assert(done.status === "complete" && done.missingSeqs.length === 0, JSON.stringify(done));
  });

  await step("guest cannot stop or end the session", async () => {
    await api("POST", `/api/sessions/${host.sessionId}/end`, { token: guest.token, expect: [403] });
  });

  await step("cross-origin cookie write is refused", async () => {
    const res = await fetch(`${BASE}/api/studios`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ name: "x" }),
    });
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });
} catch {
  failed = true;
} finally {
  abort.abort();
  server.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true });
  const errors = log.split("\n").filter((l) => /error/i.test(l) && !/AbortError/.test(l));
  if (errors.length) console.log("\nServer log errors:\n" + errors.slice(0, 20).join("\n"));
  console.log(failed ? "\nSMOKE FAILED" : "\nSMOKE PASSED");
  process.exit(failed ? 1 : 0);
}
