import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createApiHandlers } from "../src/server/api";
import type { BillingOptions } from "../src/server/billing";
import type { WebhookConfig } from "../src/server/billing-webhooks";
import type { PaddleOptions } from "../src/server/paddle";
import { openDb } from "../src/server/db";
import type { Mailer } from "../src/server/mail";
import { ROUTES } from "../src/server/routes";
import { createServices } from "../src/server/services";
import type { PresignedPut, Storage, StoredObject } from "../src/server/storage";

/** In-memory Storage. Presigned URLs point at https://storage.test/<key>; the harness fetch serves them. */
export class FakeStorage implements Storage {
  objects = new Map<string, { bytes: number; sha256: string; contentType: string; data: Buffer }>();
  /** Whether head() reports the checksum (S3 with checksums) or only the size (some backends). */
  reportsChecksum = true;
  signed: Array<{ key: string; bytes: number; sha256: string; contentType: string }> = [];

  async presignPut(key: string, opts: { bytes: number; sha256: string; contentType: string }): Promise<PresignedPut> {
    this.signed.push({ key, ...opts });
    return { url: `https://storage.test/${key}?sig=secret`, headers: { "content-type": opts.contentType } };
  }

  async head(key: string): Promise<StoredObject | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    return { bytes: o.bytes, sha256: this.reportsChecksum ? o.sha256 : undefined };
  }

  put(key: string, data: Uint8Array | string, contentType = "application/octet-stream") {
    const buf = Buffer.from(data);
    this.objects.set(key, { bytes: buf.length, sha256: sha256(buf), contentType, data: buf });
  }

  /** Keys opened with openRead, in order (tests check files are opened one at a time). */
  reads: string[] = [];

  async openRead(key: string): Promise<ReadableStream<Uint8Array>> {
    const o = this.objects.get(key);
    if (!o) throw new Error(`NoSuchKey: ${key}`);
    this.reads.push(key);
    return new Blob([new Uint8Array(o.data)]).stream();
  }

  async downloadTo(key: string, path: string) {
    const o = this.objects.get(key);
    if (!o) throw new Error(`NoSuchKey: ${key}`);
    await writeFile(path, o.data);
  }

  async uploadFrom(key: string, path: string, contentType: string) {
    const data = await readFile(path);
    this.put(key, data, contentType);
    return data.length;
  }

  async presignGet(key: string, opts: { fileName: string }) {
    return `https://storage.test/${key}?download=${encodeURIComponent(opts.fileName)}`;
  }

  async delete(keys: string[]) {
    for (const k of keys) this.objects.delete(k);
  }

  async deletePrefix(prefix: string) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    await this.delete(keys);
    return keys.length;
  }
}

export function sha256(data: Uint8Array | string) {
  return createHash("sha256").update(data).digest("hex");
}

export interface Res {
  status: number;
  body: any;
  headers: Headers;
}

const ROUTE_PATTERNS = ROUTES.map(([method, path, name]) => {
  const keys = [...path.matchAll(/\[(\w+)\]/g)].map((m) => m[1]!);
  return { method, name, keys, regex: new RegExp(`^${path.replace(/\[\w+\]/g, "([^/]+)")}$`) };
});

/** A fresh in-memory server: services, handlers, and a fetch that routes like Next.js. */
export async function createServer(storage: Storage = new FakeStorage(), opts: { allowSignup?: boolean; setupToken?: string; speedTestOrigins?: string[]; siteOrigins?: string[]; mailer?: Mailer; bytesPerSecondCap?: number; billing?: Omit<BillingOptions, "now">; billingWebhook?: WebhookConfig; paddle?: PaddleOptions; guestPromoUrl?: string; appUrl?: string; ownStorage?: Parameters<typeof createServices>[2] extends infer O ? (O extends { ownStorage?: infer S } ? S : never) : never; /** Where the server's clock starts (ms). */ clockStart?: number } = {}) {
  const db = await openDb("pglite://memory");
  let clock = opts.clockStart ?? 1_000_000;
  const services = createServices(db, storage, {
    auth: { allowSignup: opts.allowSignup ?? false, setupToken: opts.setupToken },
    bytesPerSecondCap: opts.bytesPerSecondCap,
    now: () => clock,
    speedTestOrigins: opts.speedTestOrigins,
    siteOrigins: opts.siteOrigins,
    mailer: opts.mailer,
    billing: opts.billing,
    billingWebhook: opts.billingWebhook,
    paddle: opts.paddle,
    guestPromoUrl: opts.guestPromoUrl,
    appUrl: opts.appUrl,
    ownStorage: opts.ownStorage,
  });
  const api = createApiHandlers(async () => services);

  /** Routes /api/* to handlers; everything else goes to `fallback` (fake storage by default). */
  const fetchFor =
    (fallback: typeof fetch = fakeStorageFetch(storage)): typeof fetch =>
    async (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      for (const r of ROUTE_PATTERNS) {
        const m = r.regex.exec(url.pathname);
        if (m && r.method === req.method) {
          return api[r.name](req, Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)])));
        }
      }
      return fallback(req);
    };

  /** An HTTP client with its own cookie jar, like one browser. */
  const client = (defaults: { token?: string } = {}) => {
    const jar = new Map<string, string>();
    const request = async (
      method: string,
      path: string,
      body?: unknown,
      opts: { token?: string | null; origin?: string } = {},
    ): Promise<Res> => {
      const token = opts.token === undefined ? defaults.token : opts.token;
      const headers: Record<string, string> = { host: "app.test" };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (token) headers.authorization = `Bearer ${token}`;
      if (opts.origin) headers.origin = opts.origin;
      if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await fetchFor()(`https://app.test/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair, ...attrs] = c.split(";");
        const [k, v] = pair!.split("=");
        if (attrs.some((a) => a.trim() === "Max-Age=0")) jar.delete(k!);
        else jar.set(k!, v!);
      }
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
    };
    return {
      jar,
      request,
      get: (path: string, opts?: { token?: string | null }) => request("GET", path, undefined, opts),
      post: (path: string, body: unknown = {}, opts?: { token?: string | null; origin?: string }) =>
        request("POST", path, body, opts),
      patch: (path: string, body: unknown, opts?: { origin?: string }) => request("PATCH", path, body, opts),
      put: (path: string, body: unknown, opts?: { token?: string | null; origin?: string }) => request("PUT", path, body, opts),
      del: (path: string, opts?: { origin?: string }) => request("DELETE", path, undefined, opts),
    };
  };

  return {
    db,
    services,
    api,
    fetchFor,
    client,
    tick: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

/**
 * The usual scene: an admin host with a studio open, one guest joined, a recording running.
 * `call` POSTs as the guest by default (pass a token, or null for none).
 */
export async function setup(storage: Storage = new FakeStorage(), opts: Parameters<typeof createServer>[1] = {}) {
  const server = await createServer(storage, opts);
  const hostBrowser = server.client();
  await expectOk(hostBrowser.post("/auth/signup", { email: "host@example.com", name: "Host", password: "correct horse battery" }));
  const studio = (await expectOk(hostBrowser.post("/studios", { name: "My Podcast" }))).body;
  const host = (await expectOk(hostBrowser.post(`/studios/${studio.id}/open`))).body;
  const guest = (
    await expectOk(server.client().post("/join", { inviteCode: studio.inviteCode, displayName: "Guest", consent: true }))
  ).body;
  const sessionId: string = host.sessionId;
  const recordingId: string = (await expectOk(server.client({ token: host.token }).post(`/sessions/${sessionId}/recordings`)))
    .body.recording.id;

  const call = async (path: string, body: unknown, token: string | null = guest.token) =>
    server.client().post(path, body, { token });

  return { ...server, hostBrowser, studio, host, guest, sessionId, recordingId, call };
}

export async function expectOk(res: Promise<Res> | Res): Promise<Res> {
  const r = await res;
  if (r.status >= 300) throw new Error(`Expected success, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
}

function fakeStorageFetch(storage: Storage): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.host === "storage.test" && req.method === "PUT" && storage instanceof FakeStorage) {
      storage.put(url.pathname.slice(1), new Uint8Array(await req.arrayBuffer()), req.headers.get("content-type") ?? "");
      return new Response(null, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}
