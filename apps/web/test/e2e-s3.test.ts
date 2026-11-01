// Runs only against a real S3-compatible server: `pnpm --filter @tapry/web test:s3`.
// Proves the parts a fake can't: presigned URLs work from a plain fetch, and storage
// itself refuses uploads whose size or content differ from what was signed, and deletes
// really remove objects.
import { randomBytes } from "node:crypto";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHttpTransport, MemoryChunkStore, UploadQueue, type ChunkMeta } from "@tapry/recorder";
import { chunkStorageKey } from "@tapry/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { S3Storage } from "../src/server/storage";
import { setup, sha256 } from "./harness";

const endpoint = process.env.S3_E2E_ENDPOINT;
const MIME = "video/webm;codecs=vp9,opus";

describe.skipIf(!endpoint)("upload API against real S3 storage", () => {
  const bucket = `tapry-e2e-${randomBytes(4).toString("hex")}`;
  const config = {
    endpoint,
    region: "us-east-1",
    bucket,
    accessKeyId: process.env.S3_E2E_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_E2E_SECRET_ACCESS_KEY!,
    forcePathStyle: true,
  };
  const storage = new S3Storage(config);
  const s3 = new S3Client({ ...config, credentials: config });
  let t: Awaited<ReturnType<typeof setup>>;
  let trackId: string;

  beforeAll(async () => {
    await storage.ensureBucket();
    await storage.ensureBucket(); // second call must be a no-op
    t = await setup(storage);
  });

  const newTrack = async () => {
    const res = await t.call(`/sessions/${t.sessionId}/tracks`, {
      recordingId: t.recordingId,
      kind: "video",
      mimeType: MIME,
      startedAt: 0,
    });
    return res.body.trackId as string;
  };

  const signedUrl = async (seq: number, data: Buffer) => {
    const res = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/upload-url`, {
      bytes: data.length,
      sha256: sha256(data),
      mimeType: MIME,
    });
    expect(res.status).toBe(200);
    return res.body as { url: string; headers: Record<string, string> };
  };

  const commit = (seq: number, data: Buffer) =>
    t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/commit`, {
      bytes: data.length,
      sha256: sha256(data),
      startTs: 0,
      endTs: 1,
    });

  const readObject = async (key: string) => {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  };

  it("uploads a recording through the real recorder queue, byte for byte", async () => {
    trackId = await newTrack();
    const store = new MemoryChunkStore();
    const queue = new UploadQueue({
      store,
      transport: createHttpTransport({
        baseUrl: "https://app.test/api",
        fetch: t.fetchFor(globalThis.fetch),
        headers: () => ({ authorization: `Bearer ${t.guest.token}` }),
      }),
    });
    const track = { sessionId: t.sessionId, trackId, kind: "video" as const, mimeType: MIME, startedAt: 0 };
    await store.putTrack(track);

    const originals = [randomBytes(3 * 1024 * 1024), randomBytes(1024 * 1024), randomBytes(17)];
    for (const [seq, data] of originals.entries()) {
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.length) as ArrayBuffer;
      const meta: ChunkMeta = { sessionId: t.sessionId, trackId, seq, startTs: seq * 4000, endTs: (seq + 1) * 4000, bytes: data.length };
      await store.putChunk(meta, buf);
      queue.enqueue(meta);
    }
    queue.finishTrack({ ...track, stoppedAt: 12_000, lastSeq: 2 });
    await queue.drain();
    queue.close();

    expect(queue.progress().lastError).toBeNull();
    for (const [seq, data] of originals.entries()) {
      expect((await readObject(chunkStorageKey(t.sessionId, trackId, seq))).equals(data)).toBe(true);
    }
    const [row] = await t.db.query<any>("SELECT status, last_seq, missing_seqs FROM tracks WHERE id = $1", [trackId]);
    expect(row).toEqual({ status: "complete", last_seq: 2, missing_seqs: [] });
  });

  describe("storage enforces what was signed", () => {
    beforeAll(async () => {
      trackId = await newTrack();
    });

    it("rejects a PUT with different content of the same size", async () => {
      const declared = randomBytes(4096);
      const tampered = randomBytes(4096);
      const { url, headers } = await signedUrl(0, declared);
      const put = await fetch(url, { method: "PUT", headers, body: tampered });
      const committed = await commit(0, declared);
      console.info(`[e2e] tampered PUT → ${put.status}; commit → ${committed.status} ${committed.body.error ?? ""}`);
      // Whichever layer catches it, wrong bytes must never be committed.
      expect(put.ok && committed.status === 200).toBe(false);
      expect(put.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects a PUT with a different size", async () => {
      const declared = randomBytes(4096);
      const { url, headers } = await signedUrl(1, declared);
      const put = await fetch(url, { method: "PUT", headers, body: Buffer.concat([declared, Buffer.from("x")]) });
      const committed = await commit(1, declared);
      console.info(`[e2e] oversized PUT → ${put.status}; commit → ${committed.status} ${committed.body.error ?? ""}`);
      expect(put.ok && committed.status === 200).toBe(false);
      expect(put.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects a PUT that drops the signed checksum header", async () => {
      const data = randomBytes(1024);
      const { url } = await signedUrl(2, data);
      const put = await fetch(url, { method: "PUT", headers: { "content-type": MIME }, body: data });
      console.info(`[e2e] PUT without checksum header → ${put.status}`);
      expect(put.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects a PUT to a URL whose signature was altered", async () => {
      const data = randomBytes(1024);
      const { url, headers } = await signedUrl(3, data);
      const forged = url.replace(/00000003\.chunk/, "00000099.chunk");
      const put = await fetch(forged, { method: "PUT", headers, body: data });
      expect(put.status).toBe(403);
    });

    it("accepts the honest upload after the rejected attempts", async () => {
      const data = randomBytes(4096);
      const { url, headers } = await signedUrl(0, data);
      const put = await fetch(url, { method: "PUT", headers, body: data });
      expect(put.status).toBe(200);
      expect((await commit(0, data)).status).toBe(200);
      expect((await readObject(chunkStorageKey(t.sessionId, trackId, 0))).equals(data)).toBe(true);
    });
  });

  describe("deleting", () => {
    const put = (Key: string) => s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body: "x" }));
    const list = async (Prefix: string) =>
      ((await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix }))).Contents ?? []).map((o) => o.Key);

    it("deletes by prefix, past one listing page and one DeleteObjects batch, and nothing outside it", async () => {
      const keys = Array.from({ length: 1005 }, (_, i) => `purge-test/rec/${String(i).padStart(5, "0")}.chunk`);
      for (let i = 0; i < keys.length; i += 50) await Promise.all(keys.slice(i, i + 50).map(put));
      await put("purge-test/recording-other/keep.chunk"); // shares the text "purge-test/rec" but not the folder

      expect(await storage.deletePrefix("purge-test/rec/")).toBe(1005);
      expect(await list("purge-test/")).toEqual(["purge-test/recording-other/keep.chunk"]);
      expect(await storage.deletePrefix("purge-test/rec/")).toBe(0);
    });

    it("deletes listed keys, ignoring ones already gone", async () => {
      await put("delete-test/a");
      await storage.delete(["delete-test/a", "delete-test/never-existed"]);
      expect(await list("delete-test/")).toEqual([]);
    });
  });
});
