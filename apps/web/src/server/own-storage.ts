// Own storage: an account points Tapry at its own S3-compatible bucket, and the recordings of
// its sessions go there instead of to the server's storage.
//
// How it holds together:
// - A bucket's settings are a row in `storage_targets`; the secret key is encrypted with the
//   server's STORAGE_SECRET_KEY (without that variable the feature is off).
// - A session is bound to a target when it is opened (`sessions.storage_target_id`) and never
//   changes, so replacing or removing a bucket strands nothing recorded before.
// - Every stored key carries its session's id ("recordings/<session>/…", "outputs/<session>/…"),
//   so `RoutedStorage` can send each call to the right bucket and no caller has to know.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { BlockList, isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OwnStorageView, ownStorageBody } from "@tapry/shared";
import type { z } from "zod";
import type { User } from "./auth";
import type { Db, Queryable } from "./db";
import { ApiError } from "./errors";
import { newId } from "./ids";
import { S3Storage, type PresignedPut, type S3StorageConfig, type Storage, type StoredObject } from "./storage";

// ── The secret key at rest ──────────────────────────────────────────────────────

/** AES-256-GCM under a key derived from STORAGE_SECRET_KEY. "v1:<iv>:<tag>:<data>", base64. */
export function encryptSecret(plain: string, serverKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(serverKey), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string, serverKey: string) {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unreadable stored secret");
  const decipher = createDecipheriv("aes-256-gcm", keyOf(serverKey), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

const keyOf = (serverKey: string) => createHash("sha256").update(`tapry-own-storage:${serverKey}`, "utf8").digest();

// ── Where the server may be pointed ─────────────────────────────────────────────

const PRIVATE = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) {
  PRIVATE.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96]] as const) PRIVATE.addSubnet(net, bits, "ipv6");

const isPrivate = (address: string) => {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1]! : address;
  return PRIVATE.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
};

/**
 * An endpoint someone typed must be a public HTTPS address: otherwise an account could aim this
 * server at its own network (a metadata service, the database). Checked when saved; a name
 * that later starts pointing inward is not caught here, so a hosted server should also block
 * such traffic at its firewall.
 */
export async function assertPublicEndpoint(endpoint: string, resolve: (host: string) => Promise<string[]> = resolveAll) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw badEndpoint("The endpoint isn't a web address");
  }
  if (url.protocol !== "https:") throw badEndpoint("The endpoint must start with https://");
  if (url.username || url.password) throw badEndpoint("The endpoint can't contain a user name or password");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    throw badEndpoint("The endpoint's name can't be found");
  }
  if (addresses.length === 0 || addresses.some(isPrivate)) throw badEndpoint("The endpoint must be reachable from the internet, not a private or local address");
}

const resolveAll = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);
const badEndpoint = (message: string) => new ApiError(400, "bad_endpoint", message);

// ── Which bucket a session's files live in ──────────────────────────────────────

interface TargetRow {
  id: string;
  owner_id: string;
  endpoint: string | null;
  region: string;
  bucket: string;
  access_key_id: string;
  secret_encrypted: string;
  force_path_style: boolean;
  verified_at: Date | null;
  created_at: Date;
}

export type MakeStorage = (config: S3StorageConfig) => Storage;

/**
 * Finds the storage for a session. Shared by the web server and the worker. A session's target
 * never changes, so both answers are remembered (a bounded number of them).
 */
export class StorageTargets {
  private bySession = new Map<string, Promise<Storage | null>>();
  private byTarget = new Map<string, Storage>();

  constructor(
    private db: Db,
    /** STORAGE_SECRET_KEY; null: own storage is off, and every session uses the server's storage. */
    private serverKey: string | null,
    private make: MakeStorage = (config) => new S3Storage(config),
  ) {}

  /** The account's own storage for this session, or null for the server's. */
  forSession(sessionId: string): Promise<Storage | null> {
    if (!this.serverKey) return Promise.resolve(null);
    let found = this.bySession.get(sessionId);
    if (!found) {
      found = this.load(sessionId).catch((err) => {
        this.bySession.delete(sessionId); // a database hiccup isn't remembered
        throw err;
      });
      if (this.bySession.size >= 1000) this.bySession.delete(this.bySession.keys().next().value!);
      this.bySession.set(sessionId, found);
    }
    return found;
  }

  private async load(sessionId: string): Promise<Storage | null> {
    const [row] = await this.db.query<TargetRow>(
      "SELECT t.* FROM sessions s JOIN storage_targets t ON t.id = s.storage_target_id WHERE s.id = $1",
      [sessionId],
    );
    return row ? this.open(row) : null;
  }

  /** A client for a target's bucket. */
  open(row: TargetRow): Storage {
    if (!this.serverKey) throw new Error("Own storage is off on this server");
    let storage = this.byTarget.get(row.id);
    if (!storage) {
      storage = this.make({
        endpoint: row.endpoint ?? undefined,
        region: row.region,
        bucket: row.bucket,
        accessKeyId: row.access_key_id,
        secretAccessKey: decryptSecret(row.secret_encrypted, this.serverKey),
        forcePathStyle: row.force_path_style,
      });
      if (this.byTarget.size >= 200) this.byTarget.delete(this.byTarget.keys().next().value!);
      this.byTarget.set(row.id, storage);
    }
    return storage;
  }
}

const SESSION_KEY = /^(?:recordings|outputs)\/(ses_[^/]+)\//;

/**
 * The server's storage with own-storage sessions sent to their own buckets. Everything that
 * stores or reads a recording goes through this, in the web server and the worker alike.
 */
export class RoutedStorage implements Storage {
  constructor(
    private fallback: Storage,
    private targets: StorageTargets,
  ) {}

  private async of(key: string): Promise<Storage> {
    const session = SESSION_KEY.exec(key)?.[1];
    return (session && (await this.targets.forSession(session))) || this.fallback;
  }

  async presignPut(key: string, opts: { bytes: number; sha256: string; contentType: string }): Promise<PresignedPut> {
    return (await this.of(key)).presignPut(key, opts);
  }
  async head(key: string): Promise<StoredObject | null> {
    return (await this.of(key)).head(key);
  }
  async openRead(key: string, signal?: AbortSignal) {
    return (await this.of(key)).openRead(key, signal);
  }
  async downloadTo(key: string, path: string) {
    return (await this.of(key)).downloadTo(key, path);
  }
  async uploadFrom(key: string, path: string, contentType: string) {
    return (await this.of(key)).uploadFrom(key, path, contentType);
  }
  async presignGet(key: string, opts: { fileName: string; contentType: string; ttlSeconds?: number }) {
    return (await this.of(key)).presignGet(key, opts);
  }
  async delete(keys: string[]) {
    const groups = new Map<Storage, string[]>();
    for (const key of keys) {
      const storage = await this.of(key);
      groups.set(storage, [...(groups.get(storage) ?? []), key]);
    }
    for (const [storage, list] of groups) await storage.delete(list);
  }
  async deletePrefix(prefix: string) {
    return (await this.of(prefix)).deletePrefix(prefix);
  }
}

// ── Setting it up ───────────────────────────────────────────────────────────────

const CHECK_PREFIX = "tapry-check/";
const CHECK_BODY = "Tapry upload check. Safe to delete.\n";
const CHECK_TYPE = "text/plain";

export interface OwnStorageOptions {
  /** STORAGE_SECRET_KEY. Null: the feature is off. */
  serverKey: string | null;
  /** Accept private and plain-HTTP endpoints (a trusted self-hosted install, tests). */
  allowPrivate?: boolean;
  /** Whether this account may use its own storage (on Tapry Cloud, its plan says). */
  allowed?: (userId: string, db: Queryable) => Promise<boolean>;
  /** Whether this account has no other storage: it can't record until its own is connected. */
  required?: (userId: string, db: Queryable) => Promise<boolean>;
  resolve?: (host: string) => Promise<string[]>;
}

export class OwnStorageService {
  constructor(
    private db: Db,
    private targets: StorageTargets,
    private opts: OwnStorageOptions,
  ) {}

  get enabled() {
    return !!this.opts.serverKey;
  }

  private async allowed(userId: string, db: Queryable = this.db) {
    return this.enabled && (this.opts.allowed ? await this.opts.allowed(userId, db) : true);
  }

  private current(db: Queryable, userId: string, lock = "") {
    return db.query<TargetRow>(`SELECT * FROM storage_targets WHERE owner_id = $1 AND retired_at IS NULL ${lock}`, [userId]).then((rows) => rows[0] ?? null);
  }

  /** What the Storage page shows: whether the feature is there, and the bucket if one is set. Never the secret. */
  async view(user: User): Promise<OwnStorageView> {
    const allowed = await this.allowed(user.id);
    const row = this.enabled ? await this.current(this.db, user.id) : null;
    return {
      enabled: this.enabled,
      allowed,
      required: allowed && !!this.opts.required && (await this.opts.required(user.id, this.db)),
      target: row && {
        endpoint: row.endpoint,
        region: row.region,
        bucket: row.bucket,
        accessKeyEnding: row.access_key_id.slice(-4),
        forcePathStyle: row.force_path_style,
        verified: row.verified_at !== null,
        savedAt: row.created_at.toISOString(),
      },
    };
  }

  /**
   * Save a bucket's settings, after proving from this server that it can write, read and delete
   * there. It isn't used yet: the browser check (below) must pass first, because guests upload
   * straight from their browsers and only the bucket's CORS rules allow that.
   */
  async save(user: User, body: z.infer<typeof ownStorageBody>): Promise<OwnStorageView> {
    if (!this.enabled) throw new ApiError(404, "not_found", "Not found");
    if (!(await this.allowed(user.id))) throw new ApiError(403, "plan_without_own_storage", "Your plan doesn't include your own storage");
    const endpoint = body.endpoint?.trim() || null;
    if (endpoint && !this.opts.allowPrivate) await assertPublicEndpoint(endpoint, this.opts.resolve);

    const row: TargetRow = {
      id: newId("stg"),
      owner_id: user.id,
      endpoint,
      region: body.region,
      bucket: body.bucket,
      access_key_id: body.accessKeyId,
      secret_encrypted: encryptSecret(body.secretAccessKey, this.opts.serverKey!),
      force_path_style: body.forcePathStyle,
      verified_at: null,
      created_at: new Date(),
    };
    await this.serverCheck(this.targets.open(row), row.id);

    await this.db.transaction(async (tx) => {
      await tx.query("UPDATE storage_targets SET retired_at = now() WHERE owner_id = $1 AND retired_at IS NULL", [user.id]);
      await tx.query(
        `INSERT INTO storage_targets (id, owner_id, endpoint, region, bucket, access_key_id, secret_encrypted, force_path_style)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [row.id, row.owner_id, row.endpoint, row.region, row.bucket, row.access_key_id, row.secret_encrypted, row.force_path_style],
      );
    });
    return this.view(user);
  }

  private async serverCheck(storage: Storage, targetId: string) {
    const key = `${CHECK_PREFIX}${targetId}-server.txt`;
    const dir = await mkdtemp(join(tmpdir(), "tapry-own-storage-"));
    try {
      const path = join(dir, "check.txt");
      await writeFile(path, CHECK_BODY);
      await storage.uploadFrom(key, path, CHECK_TYPE);
      const found = await storage.head(key);
      if (!found || found.bytes !== Buffer.byteLength(CHECK_BODY)) throw Object.assign(new Error("not found after writing"), { name: "NotFoundAfterWrite" });
      await storage.delete([key]);
    } catch (err) {
      // The error's name only ("AccessDenied", "NoSuchBucket"): its message can quote keys and hosts.
      const name = err instanceof Error && /^[A-Za-z0-9_.]+$/.test(err.name) ? err.name : "Error";
      throw new ApiError(400, "storage_check_failed", `Tapry couldn't write to, read from and delete in that bucket (${name}). Check the bucket's name, the keys and what they are allowed to do.`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** A signed upload for the browser to try, exactly like a guest's upload of a recording piece. */
  async browserCheck(user: User): Promise<PresignedPut & { key: string; body: string }> {
    const row = this.enabled ? await this.current(this.db, user.id) : null;
    if (!row) throw new ApiError(404, "no_storage", "No storage of your own is set up");
    const key = `${CHECK_PREFIX}${row.id}-${randomBytes(9).toString("base64url")}.txt`;
    const put = await this.targets.open(row).presignPut(key, {
      bytes: Buffer.byteLength(CHECK_BODY),
      sha256: createHash("sha256").update(CHECK_BODY).digest("hex"),
      contentType: CHECK_TYPE,
    });
    return { ...put, key, body: CHECK_BODY };
  }

  /** The browser says its upload went through: look, and from now on new sessions record there. */
  async confirmBrowserCheck(user: User, key: string): Promise<OwnStorageView> {
    const row = this.enabled ? await this.current(this.db, user.id) : null;
    if (!row || !key.startsWith(`${CHECK_PREFIX}${row.id}-`)) throw new ApiError(404, "no_storage", "No storage of your own is set up");
    const storage = this.targets.open(row);
    const found = await storage.head(key).catch(() => null);
    if (!found || found.bytes !== Buffer.byteLength(CHECK_BODY)) {
      throw new ApiError(409, "upload_not_found", "The test upload from your browser didn't arrive in the bucket");
    }
    await storage.delete([key]).catch(() => {});
    await this.db.query("UPDATE storage_targets SET verified_at = coalesce(verified_at, now()) WHERE id = $1 AND retired_at IS NULL", [row.id]);
    return this.view(user);
  }

  /**
   * Stop using the bucket for new sessions. What was recorded there stays there, and Tapry
   * keeps the settings to go on serving those recordings.
   */
  async remove(user: User): Promise<OwnStorageView> {
    if (!this.enabled) throw new ApiError(404, "not_found", "Not found");
    await this.db.query("UPDATE storage_targets SET retired_at = now() WHERE owner_id = $1 AND retired_at IS NULL", [user.id]);
    return this.view(user);
  }

  /**
   * For a session about to be created for this owner: the target it will record into, or null
   * for the server's storage. Refuses when the account has no storage of any kind.
   */
  async targetForNewSession(tx: Queryable, ownerId: string): Promise<string | null> {
    if (await this.allowed(ownerId, tx)) {
      const row = await this.current(tx, ownerId);
      if (row?.verified_at) return row.id;
    }
    if (this.opts.required && (await this.opts.required(ownerId, tx))) {
      throw new ApiError(409, "storage_not_set_up", "Connect your own storage first (Storage page): your plan records into your bucket, and none is connected yet.");
    }
    return null;
  }
}
