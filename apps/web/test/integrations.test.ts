// API keys (the app's API with a key instead of a log-in) and webhooks (a signed POST when a
// recording is ready).
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { deliverWebhooks, emitWebhook, KEY_REQUESTS_PER_MINUTE, signWebhook, WEBHOOK_ATTEMPTS } from "../src/server/integrations";
import { expectOk, setup } from "./harness";

const ORIGIN = { origin: "https://app.test" };

describe("API keys", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let key: string;
  beforeEach(async () => {
    t = await setup();
    key = (await expectOk(t.hostBrowser.post("/keys", { name: "Editing script" }, ORIGIN))).body.key;
  });
  const withKey = (method: string, path: string, body?: unknown, k = key) =>
    t.fetchFor()(`https://app.test/api${path}`, { method, headers: { authorization: `Bearer ${k}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });

  it("are shown once when made, listed by their first characters, and stored only as a hash", async () => {
    expect(key).toMatch(/^tpk_[\w-]{30,}$/);
    const { keys } = (await t.hostBrowser.get("/keys")).body;
    expect(keys).toEqual([{ id: expect.stringMatching(/^key_/), name: "Editing script", prefix: `${key.slice(0, 10)}…`, createdAt: expect.any(String), lastUsedAt: null }]);
    expect(JSON.stringify(await t.db.query("SELECT * FROM api_keys"))).not.toContain(key);
  });

  it("read what the account's members can read, and change only what is opened to keys", async () => {
    const studios = await withKey("GET", "/studios");
    expect([studios.status, (await studios.json()).studios.map((s: { id: string }) => s.id)]).toEqual([200, [t.studio.id]]);
    expect((await withKey("GET", `/studios/${t.studio.id}/recordings`)).status).toBe(200);
    expect((await withKey("PATCH", `/studios/${t.studio.id}`, { name: "Renamed by script" })).status).toBe(200);
    expect((await withKey("POST", `/recordings/${t.recordingId}/comments`, { body: "From the script" })).status).toBe(201);
    expect((await t.hostBrowser.get(`/recordings/${t.recordingId}/comments`)).body.comments[0].author).toBe('API key "Editing script"');
    // Not the owner's things, not hosting, not other keys, not deleting a studio.
    for (const res of [
      await withKey("POST", "/keys", { name: "Another" }),
      await withKey("POST", "/members/invites", { email: "x@example.com" }),
      await withKey("POST", `/studios/${t.studio.id}/open`),
      await withKey("DELETE", `/studios/${t.studio.id}`),
      await withKey("PUT", "/ai-notes", { outside: true }),
    ]) {
      expect([res.status, (await res.json()).error]).toEqual([403, "not_for_keys"]);
    }
    expect((await withKey("GET", "/keys")).status).toBe(403); // listing keys is the owner's
    // What a key did is in the activity log under its name.
    expect((await t.hostBrowser.get("/activity")).body.activity[0]).toMatchObject({ who: 'API key "Editing script"', action: "Changed a studio" });
  });

  it("stop working when revoked, and unknown keys are refused", async () => {
    const [{ id }] = (await t.hostBrowser.get("/keys")).body.keys;
    expect((await t.hostBrowser.del(`/keys/${id}`, ORIGIN)).status).toBe(204);
    expect((await withKey("GET", "/studios")).status).toBe(401);
    expect((await withKey("GET", "/studios", undefined, "tpk_not-a-real-key")).status).toBe(401);
    expect((await t.hostBrowser.get("/keys")).body.keys).toEqual([]);
  });

  it("are limited per minute, each on its own", async () => {
    for (let i = 0; i < KEY_REQUESTS_PER_MINUTE; i++) await t.services.apiKeys.userFor(key);
    expect((await withKey("GET", "/studios")).status).toBe(429);
    t.tick(61_000);
    expect((await withKey("GET", "/studios")).status).toBe(200);
  });

  it("are the owner's to make", async () => {
    const { link } = (await expectOk(t.hostBrowser.post("/members/invites", { email: "mia@example.com" }, ORIGIN))).body;
    const mia = t.client();
    await expectOk(mia.post(`/invites/${/\/invite\/([\w-]+)$/.exec(link)![1]}`, { name: "Mia", password: "correct horse battery" }, ORIGIN));
    expect((await mia.post("/keys", { name: "Mine" }, ORIGIN)).status).toBe(403);
    expect((await mia.get("/webhooks")).status).toBe(403);
  });
});

describe("webhooks", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let hook: { id: string; secret: string };
  const sent: Array<{ url: string; headers: Headers; body: string }> = [];
  let answer = 200;
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), headers: new Headers(init.headers), body: String(init.body) });
    return new Response(null, { status: answer });
  }) as unknown as typeof fetch;
  beforeEach(async () => {
    sent.length = 0;
    answer = 200;
    t = await setup(undefined, { ownStorage: { serverKey: null, resolve: async () => ["93.184.216.34"] } });
    hook = (await expectOk(t.hostBrowser.post("/webhooks", { url: "https://hooks.example.com/tapry" }, ORIGIN))).body;
  });

  it("go to public https addresses only, with a secret shown once", async () => {
    expect(hook.secret).toMatch(/^whsec_/);
    expect((await t.hostBrowser.get("/webhooks")).body.webhooks).toEqual([{ id: hook.id, url: "https://hooks.example.com/tapry", createdAt: expect.any(String), failing: false }]);
    expect((await t.hostBrowser.post("/webhooks", { url: "http://hooks.example.com/x" }, ORIGIN)).status).toBe(400);
    const inward = await setup(undefined, { ownStorage: { serverKey: null, resolve: async () => ["10.0.0.5"] } });
    expect((await inward.hostBrowser.post("/webhooks", { url: "https://intranet.example.com/x" }, ORIGIN)).status).toBe(400);
  });

  it("deliver a signed description of the recording: names, times and files, never what was said", async () => {
    await t.db.query("INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes) VALUES ('out_a', $1, 'audio', 'Guest - audio.wav', 'audio/wav', 'k', 1234)", [t.recordingId]);
    await emitWebhook(t.db, t.recordingId, "recording.ready", t.now());
    await deliverWebhooks(t.db, fetcher, t.now);
    expect(sent).toHaveLength(1);
    const { url, headers, body } = sent[0]!;
    expect(url).toBe("https://hooks.example.com/tapry");
    expect(headers.get("tapry-event")).toBe("recording.ready");
    const payload = JSON.parse(body);
    expect(payload).toMatchObject({ event: "recording.ready", recording: { id: t.recordingId, number: 1, studio: { id: t.studio.id, name: "My Podcast" }, files: [{ id: "out_a", kind: "audio", fileName: "Guest - audio.wav", bytes: 1234 }] } });
    // The receiver can check it came from us and wasn't changed.
    const [, at, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers.get("tapry-signature")!)!;
    expect(v1).toBe(createHmac("sha256", hook.secret).update(`${at}.${body}`).digest("hex"));
    expect(signWebhook(hook.secret, body, Number(at))).toBe(headers.get("tapry-signature"));
    // Sent once.
    await deliverWebhooks(t.db, fetcher, t.now);
    expect(sent).toHaveLength(1);
  });

  it("try again later when the receiver is down, then give up and say so", async () => {
    answer = 503;
    await emitWebhook(t.db, t.recordingId, "recording.transcribed", t.now());
    await deliverWebhooks(t.db, fetcher, t.now);
    await deliverWebhooks(t.db, fetcher, t.now); // not due yet
    expect(sent).toHaveLength(1);
    for (let i = 1; i < WEBHOOK_ATTEMPTS; i++) {
      t.tick(7 * 3_600_000);
      await deliverWebhooks(t.db, fetcher, t.now);
    }
    expect(sent).toHaveLength(WEBHOOK_ATTEMPTS);
    expect(await t.db.query("SELECT status, attempts, last_error FROM webhook_deliveries")).toEqual([{ status: "failed", attempts: WEBHOOK_ATTEMPTS, last_error: "status 503" }]);
    expect((await t.hostBrowser.get("/webhooks")).body.webhooks[0].failing).toBe(true);
    t.tick(7 * 3_600_000);
    await deliverWebhooks(t.db, fetcher, t.now);
    expect(sent).toHaveLength(WEBHOOK_ATTEMPTS);
  });

  it("stop with their webhook", async () => {
    await emitWebhook(t.db, t.recordingId, "recording.ready", t.now());
    expect((await t.hostBrowser.del(`/webhooks/${hook.id}`, ORIGIN)).status).toBe(204);
    await deliverWebhooks(t.db, fetcher, t.now);
    expect(sent).toEqual([]);
  });
});
