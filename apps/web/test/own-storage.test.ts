import { chunkStorageKey } from "@tapry/shared";
import { describe, expect, it } from "vitest";
import { JobRunner } from "../src/server/jobs";
import { assertPublicEndpoint, decryptSecret, encryptSecret } from "../src/server/own-storage";
import type { S3StorageConfig } from "../src/server/storage";
import { createServer, expectOk, FakeStorage, sha256 } from "./harness";

const KEY = "a-server-key-of-enough-length";
const ORIGIN = { origin: "https://app.test" };
const MIME = "audio/webm;codecs=opus";
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
/** The recording pieces a storage signed uploads for (not the set-up check's test file). */
const pieces = (storage: FakeStorage) => storage.signed.map((s) => s.key).filter((k) => k.startsWith("recordings/"));
const piece = (r: { sessionId: string; trackId: string }) => chunkStorageKey(r.sessionId, r.trackId, 0);

const BUCKET = { endpoint: "https://s3.example.com", region: "eu-central-1", bucket: "my-recordings", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: SECRET, forcePathStyle: true };

/** A server where own storage is on. Every bucket an account connects is a FakeStorage, kept by bucket name. */
async function server(opts: { cloud?: boolean; key?: string | null } = {}) {
  const serverStorage = new FakeStorage();
  const buckets = new Map<string, FakeStorage>();
  const configs: S3StorageConfig[] = [];
  const t = await createServer(serverStorage, {
    allowSignup: true,
    billing: { cloud: !!opts.cloud },
    ownStorage: {
      serverKey: opts.key === undefined ? KEY : opts.key,
      resolve: async (host) => (host === "inside.example.com" ? ["10.1.2.3"] : ["93.184.216.34"]),
      make: (config) => {
        configs.push(config);
        if (!buckets.has(config.bucket)) buckets.set(config.bucket, new FakeStorage());
        return buckets.get(config.bucket)!;
      },
    },
  });
  const host = t.client();
  const user = (await expectOk(host.post("/auth/signup", { email: "host@example.com", name: "Host", password: "correct horse battery" }))).body.user;
  const studio = (await expectOk(host.post("/studios", { name: "My Podcast" }))).body;

  /** Save a bucket and pass the browser check, as the Storage page does. */
  const connect = async (bucket = BUCKET.bucket) => {
    await expectOk(host.put("/storage/own", { ...BUCKET, bucket }, ORIGIN));
    const check = (await expectOk(host.post("/storage/own/check"))).body;
    buckets.get(bucket)!.put(check.key, check.body); // the browser's PUT
    return (await expectOk(host.post("/storage/own/check/confirm", { key: check.key }))).body;
  };
  /** Open the studio (a new session after `end`), and start a recording with one track that asks to upload a piece. */
  const record = async () => {
    const ticket = (await expectOk(host.post(`/studios/${studio.id}/open`))).body;
    const asHost = t.client({ token: ticket.token });
    const recordingId = (await expectOk(asHost.post(`/sessions/${ticket.sessionId}/recordings`))).body.recording.id as string;
    const { trackId } = (await expectOk(asHost.post(`/sessions/${ticket.sessionId}/tracks`, { recordingId, kind: "audio", mimeType: MIME, startedAt: t.now() }))).body;
    const meta = { bytes: 3, sha256: sha256("abc") };
    const signed = (await expectOk(asHost.post(`/sessions/${ticket.sessionId}/tracks/${trackId}/chunks/0/upload-url`, { ...meta, mimeType: MIME }))).body;
    const end = async () => {
      await expectOk(asHost.post(`/sessions/${ticket.sessionId}/recordings/${recordingId}/stop`));
      await expectOk(asHost.post(`/sessions/${ticket.sessionId}/end`));
    };
    return { sessionId: ticket.sessionId as string, recordingId, trackId: trackId as string, signedUrl: signed.url as string, asHost, end, meta };
  };
  return { ...t, serverStorage, buckets, configs, host, user, studio, connect, record };
}

describe("the secret key at rest", () => {
  it("is encrypted with the server's key: readable only with it, different every time", () => {
    const a = encryptSecret(SECRET, KEY);
    const b = encryptSecret(SECRET, KEY);
    expect(a).not.toContain(SECRET);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(SECRET);
    expect(() => decryptSecret(a, "another-server-key-entirely")).toThrow();
    expect(() => decryptSecret(a.slice(0, -4) + "AAAA", KEY)).toThrow(); // tampered
  });
});

describe("where the server may be pointed", () => {
  const resolve = async (host: string) => (host === "inside.example.com" ? ["10.1.2.3"] : host === "mixed.example.com" ? ["93.184.216.34", "127.0.0.1"] : ["93.184.216.34"]);
  const refused = (endpoint: string) => expect(assertPublicEndpoint(endpoint, resolve)).rejects.toMatchObject({ code: "bad_endpoint" });

  it("takes a public https address", async () => {
    await assertPublicEndpoint("https://s3.example.com", resolve);
    await assertPublicEndpoint("https://93.184.216.34:9000/path", resolve);
  });

  it("refuses anything that leads inside: plain http, local and private addresses, names that resolve there", async () => {
    await refused("http://s3.example.com");
    await refused("not an address");
    await refused("https://user:pass@s3.example.com");
    for (const host of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "0.0.0.0", "[::1]", "[fd00::1]", "[fe80::1]", "[::ffff:10.0.0.5]"]) {
      await refused(`https://${host}`);
    }
    await refused("https://inside.example.com");
    await refused("https://mixed.example.com"); // one inside address is enough
  });
});

describe("own storage", () => {
  it("is off without STORAGE_SECRET_KEY: nothing can be saved, and sessions use the server's storage", async () => {
    const t = await server({ key: null });
    expect((await expectOk(t.host.get("/storage/own"))).body).toEqual({ enabled: false, allowed: false, required: false, target: null });
    expect((await t.host.put("/storage/own", BUCKET, ORIGIN)).status).toBe(404);
    await t.record();
    expect(pieces(t.serverStorage)).toHaveLength(1);
  });

  it("saves a bucket only after writing, reading and deleting there, and never gives the secret back", async () => {
    const t = await server();
    const view = (await expectOk(t.host.put("/storage/own", BUCKET, ORIGIN))).body;
    expect(view).toMatchObject({
      enabled: true,
      allowed: true,
      required: false,
      target: { endpoint: "https://s3.example.com", region: "eu-central-1", bucket: "my-recordings", accessKeyEnding: "MPLE", forcePathStyle: true, verified: false },
    });
    expect(JSON.stringify(view)).not.toContain(SECRET);
    // The bucket's client got the real secret; the database only its encrypted form.
    expect(t.configs[0]).toMatchObject({ bucket: "my-recordings", secretAccessKey: SECRET, endpoint: "https://s3.example.com", forcePathStyle: true });
    const [row] = await t.db.query<{ secret_encrypted: string }>("SELECT * FROM storage_targets");
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(decryptSecret(row!.secret_encrypted, KEY)).toBe(SECRET);
    // The server's own test file is gone again.
    expect([...t.buckets.get("my-recordings")!.objects.keys()]).toEqual([]);
  });

  it("refuses a bucket it can't use, saying why by the error's name only", async () => {
    const t = await server();
    await expectOk(t.host.put("/storage/own", BUCKET, ORIGIN));
    t.buckets.get("my-recordings")!.uploadFrom = async () => {
      throw Object.assign(new Error(`Access Denied for ${SECRET} at s3.example.com`), { name: "AccessDenied" });
    };
    const res = await t.host.put("/storage/own", { ...BUCKET, accessKeyId: "AKIAANOTHER" }, ORIGIN);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("storage_check_failed");
    expect(res.body.message).toContain("(AccessDenied)");
    expect(res.body.message).not.toContain(SECRET);
    // The settings that worked are still the current ones.
    expect((await t.host.get("/storage/own")).body.target.accessKeyEnding).toBe("MPLE");
  });

  it("refuses an endpoint that leads inside, and input that isn't a bucket", async () => {
    const t = await server();
    for (const endpoint of ["http://s3.example.com", "https://127.0.0.1:9000", "https://inside.example.com"]) {
      const res = await t.host.put("/storage/own", { ...BUCKET, endpoint }, ORIGIN);
      expect([res.status, res.body.error]).toEqual([400, "bad_endpoint"]);
    }
    expect((await t.host.put("/storage/own", { ...BUCKET, bucket: "Not A Bucket" }, ORIGIN)).status).toBe(400);
    expect((await t.host.put("/storage/own", { ...BUCKET, secretAccessKey: "" }, ORIGIN)).status).toBe(400);
    expect(t.configs).toEqual([]);
    // Amazon S3 itself has no endpoint to type.
    await expectOk(t.host.put("/storage/own", { ...BUCKET, endpoint: "" }, ORIGIN));
    expect(t.configs[0]!.endpoint).toBeUndefined();
  });

  it("isn't used until a test upload from a browser has arrived", async () => {
    const t = await server();
    await expectOk(t.host.put("/storage/own", BUCKET, ORIGIN));
    const first = await t.record();
    expect(pieces(t.serverStorage)).toHaveLength(1); // saved but unproven: the server's storage
    await first.end();

    const check = (await expectOk(t.host.post("/storage/own/check"))).body;
    expect(check.key).toMatch(/^tapry-check\/stg_[\w-]+-[\w-]+\.txt$/);
    expect(check.url).toContain(check.key);
    expect(check.headers["content-type"]).toBe("text/plain");
    // Nothing arrived yet, or a key that isn't this bucket's check.
    expect((await t.host.post("/storage/own/check/confirm", { key: check.key })).status).toBe(409);
    expect((await t.host.post("/storage/own/check/confirm", { key: "recordings/ses_x/trk_y/0" })).status).toBe(404);

    t.buckets.get("my-recordings")!.put(check.key, check.body);
    expect((await expectOk(t.host.post("/storage/own/check/confirm", { key: check.key }))).body.target.verified).toBe(true);
    expect([...t.buckets.get("my-recordings")!.objects.keys()]).toEqual([]); // the test file is removed

    const second = await t.record();
    expect(pieces(t.serverStorage)).toHaveLength(1);
    expect(pieces(t.buckets.get("my-recordings")!)).toEqual([piece(second)]);
  });

  it("records a session into its bucket from upload to deletion, and other accounts into the server's", async () => {
    const t = await server();
    await t.connect();
    const mine = await t.record();
    const bucket = t.buckets.get("my-recordings")!;
    const key = piece(mine);
    expect(mine.signedUrl).toContain(key);

    // The piece lands in the bucket, and the server confirms it there.
    bucket.put(key, "abc");
    await expectOk(mine.asHost.post(`/sessions/${mine.sessionId}/tracks/${mine.trackId}/chunks/0/commit`, { ...mine.meta, startTs: t.now(), endTs: t.now() + 1 }));
    expect(t.serverStorage.objects.size).toBe(0);

    // Someone else on this server, without a bucket of their own.
    const other = t.client();
    await expectOk(other.post("/auth/signup", { email: "other@example.com", name: "Other", password: "correct horse battery" }));
    const theirs = (await expectOk(other.post("/studios", { name: "Theirs" }))).body;
    const ticket = (await expectOk(other.post(`/studios/${theirs.id}/open`))).body;
    const asOther = t.client({ token: ticket.token });
    const rec = (await expectOk(asOther.post(`/sessions/${ticket.sessionId}/recordings`))).body.recording.id;
    const track = (await expectOk(asOther.post(`/sessions/${ticket.sessionId}/tracks`, { recordingId: rec, kind: "audio", mimeType: MIME, startedAt: t.now() }))).body.trackId;
    await expectOk(asOther.post(`/sessions/${ticket.sessionId}/tracks/${track}/chunks/0/upload-url`, { ...mine.meta, mimeType: MIME }));
    expect(pieces(t.serverStorage)).toEqual([chunkStorageKey(ticket.sessionId, track, 0)]);
    expect(pieces(bucket)).toHaveLength(1);

    // Deleting the recording removes its files from the bucket (the worker goes through the same routing).
    await mine.end();
    await t.db.query("DELETE FROM jobs");
    await expectOk(t.host.del(`/studios/${t.studio.id}/recordings/${mine.recordingId}`, ORIGIN));
    await new JobRunner(t.db, t.services.storage, { ffmpeg: "ffmpeg", ffprobe: "ffprobe" }).drain();
    expect([...bucket.objects.keys()]).toEqual([]);
  });

  it("keeps a session in the bucket it was opened with when the bucket is replaced or removed", async () => {
    const t = await server();
    await t.connect("first-bucket");
    const one = await t.record();
    await one.end();

    await t.connect("second-bucket");
    const two = await t.record();
    await two.end();
    expect(pieces(t.buckets.get("first-bucket")!)).toEqual([piece(one)]);
    expect(pieces(t.buckets.get("second-bucket")!)).toEqual([piece(two)]);

    expect((await expectOk(t.host.del("/storage/own", ORIGIN))).body.target).toBeNull();
    const three = await t.record();
    expect(pieces(t.serverStorage)).toEqual([piece(three)]);

    // The first session's files are still served from the first bucket.
    t.buckets.get("first-bucket")!.put(`outputs/${one.sessionId}/${one.recordingId}/a.wav`, "audio");
    expect(await t.services.storage.head(`outputs/${one.sessionId}/${one.recordingId}/a.wav`)).toMatchObject({ bytes: 5 });
    expect(await t.services.storage.presignGet(`outputs/${one.sessionId}/${one.recordingId}/a.wav`, { fileName: "a.wav", contentType: "audio/wav" })).toContain("storage.test/outputs/");
    // One call that spans buckets deletes in each.
    t.serverStorage.put("health/check-1.txt", "x");
    t.buckets.get("second-bucket")!.put(`outputs/${two.sessionId}/${two.recordingId}/b.wav`, "audio");
    await t.services.storage.delete([`outputs/${one.sessionId}/${one.recordingId}/a.wav`, `outputs/${two.sessionId}/${two.recordingId}/b.wav`, "health/check-1.txt"]);
    expect([t.buckets.get("first-bucket")!.objects.size, t.buckets.get("second-bucket")!.objects.size, t.serverStorage.objects.size]).toEqual([0, 0, 0]);
  });

  it("belongs to the account: nobody else sees or changes it", async () => {
    const t = await server();
    await t.connect();
    const other = t.client();
    await expectOk(other.post("/auth/signup", { email: "other@example.com", name: "Other", password: "correct horse battery" }));
    expect((await other.get("/storage/own")).body.target).toBeNull();
    expect((await other.post("/storage/own/check")).status).toBe(404);
    await expectOk(other.del("/storage/own", ORIGIN));
    expect((await t.host.get("/storage/own")).body.target.verified).toBe(true);
    expect((await t.client().get("/storage/own")).status).toBe(401);
  });
});

describe("own storage on Tapry Cloud", () => {
  const setPlan = async (t: Awaited<ReturnType<typeof server>>, plan: string) =>
    expectOk(t.host.put(`/admin/accounts/${t.user.id}/plan`, { plan }, ORIGIN)); // the first account is the admin

  it("isn't part of the Free plan", async () => {
    const t = await server({ cloud: true });
    expect((await t.host.get("/storage/own")).body).toMatchObject({ enabled: true, allowed: false, required: false });
    const res = await t.host.put("/storage/own", BUCKET, ORIGIN);
    expect([res.status, res.body.error]).toEqual([403, "plan_without_own_storage"]);
  });

  it("is the only storage of the Own storage plan: no session opens until a bucket is connected, then hours aren't limited", async () => {
    const t = await server({ cloud: true });
    await setPlan(t, "own_storage");
    expect((await t.host.get("/storage/own")).body).toMatchObject({ allowed: true, required: true, target: null });
    const refused = await t.host.post(`/studios/${t.studio.id}/open`);
    expect([refused.status, refused.body.error]).toEqual([409, "storage_not_set_up"]);
    // Saved but not proven from a browser isn't enough either.
    await expectOk(t.host.put("/storage/own", BUCKET, ORIGIN));
    expect((await t.host.post(`/studios/${t.studio.id}/open`)).status).toBe(409);

    await t.connect();
    const rec = await t.record();
    expect(pieces(t.buckets.get("my-recordings")!)).toHaveLength(1);
    expect(pieces(t.serverStorage)).toEqual([]);
    t.tick(200 * 3_600_000); // far past any hosted plan's hours
    await rec.end();
    await t.record();
    expect((await t.host.get("/billing")).body.plan).toMatchObject({ id: "own_storage", hours: null, filesDays: null });
  });

  it("stops being used when the plan no longer includes it, without touching what is in the bucket", async () => {
    const t = await server({ cloud: true });
    await setPlan(t, "own_storage");
    await t.connect();
    const first = await t.record();
    await first.end();
    await setPlan(t, "creator");
    const second = await t.record();
    expect(pieces(t.serverStorage)).toEqual([piece(second)]);
    expect(pieces(t.buckets.get("my-recordings")!)).toHaveLength(1);
  });
});
