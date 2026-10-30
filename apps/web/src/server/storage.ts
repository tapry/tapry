import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface PresignedPut {
  url: string;
  /** Headers the browser must send with the PUT; they are part of the signature. */
  headers: Record<string, string>;
}

export interface StoredObject {
  bytes: number;
  /** Hex SHA-256 if the backend stored the checksum we signed, else undefined. */
  sha256?: string;
}

export interface Storage {
  presignPut(key: string, opts: { bytes: number; sha256: string; contentType: string }): Promise<PresignedPut>;
  head(key: string): Promise<StoredObject | null>;
  /** Download an object to a local file (the worker reads chunks this way). */
  downloadTo(key: string, path: string): Promise<void>;
  /** Upload a local file; returns its size. Large files go up in parts. */
  uploadFrom(key: string, path: string, contentType: string): Promise<number>;
  /** Short-lived download link that saves under `fileName`. */
  presignGet(key: string, opts: { fileName: string; contentType: string; ttlSeconds?: number }): Promise<string>;
  /** Delete these objects. Missing ones are fine. */
  delete(keys: string[]): Promise<void>;
  /** Delete every object whose key starts with `prefix`; returns how many there were. */
  deletePrefix(prefix: string): Promise<number>;
}

/** Default lifetime of presigned upload URLs, in seconds. */
export const UPLOAD_URL_TTL_S = 15 * 60;

export interface S3StorageConfig {
  endpoint?: string;
  /** Endpoint browsers reach, when it differs from the one this server uses. */
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Seconds a presigned URL stays valid. */
  urlTtl?: number;
}

export class S3Storage implements Storage {
  private client: S3Client;
  private signer: S3Client;

  constructor(private config: S3StorageConfig) {
    const base = {
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Newer SDKs add CRC32 checksums to every request by default, which presigned
      // browser uploads can't satisfy and some S3-compatible stores reject.
      requestChecksumCalculation: "WHEN_REQUIRED" as const,
      responseChecksumValidation: "WHEN_REQUIRED" as const,
    };
    this.client = new S3Client({ ...base, endpoint: config.endpoint });
    this.signer = new S3Client({ ...base, endpoint: config.publicEndpoint ?? config.endpoint });
  }

  async presignPut(key: string, opts: { bytes: number; sha256: string; contentType: string }) {
    const checksum = Buffer.from(opts.sha256, "hex").toString("base64");
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentLength: opts.bytes,
      ContentType: opts.contentType,
      ChecksumSHA256: checksum,
    });
    const url = await getSignedUrl(this.signer, command, {
      expiresIn: this.config.urlTtl ?? UPLOAD_URL_TTL_S,
      // Signing these means storage rejects a PUT whose size, type or content differs
      // from what the client declared — the browser sets Content-Length itself.
      signableHeaders: new Set(["content-length", "content-type"]),
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
    });
    return { url, headers: { "content-type": opts.contentType, "x-amz-checksum-sha256": checksum } };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key, ChecksumMode: "ENABLED" }),
      );
      return {
        bytes: res.ContentLength ?? 0,
        sha256: res.ChecksumSHA256 ? Buffer.from(res.ChecksumSHA256, "base64").toString("hex") : undefined,
      };
    } catch (err) {
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async downloadTo(key: string, path: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty body for ${key}`);
    await streamPipeline(res.Body as Readable, createWriteStream(path));
  }

  async uploadFrom(key: string, path: string, contentType: string) {
    const { size } = await stat(path);
    await new Upload({
      client: this.client,
      params: { Bucket: this.config.bucket, Key: key, Body: createReadStream(path), ContentType: contentType },
      partSize: 16 * 1024 * 1024,
      queueSize: 4,
    }).done();
    return size;
  }

  async presignGet(key: string, opts: { fileName: string; contentType: string; ttlSeconds?: number }) {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ResponseContentType: opts.contentType,
      ResponseContentDisposition: contentDisposition(opts.fileName),
    });
    return getSignedUrl(this.signer, command, { expiresIn: opts.ttlSeconds ?? 10 * 60 });
  }

  async delete(keys: string[]) {
    // DeleteObjects takes at most 1000 keys per request.
    for (let i = 0; i < keys.length; i += 1000) {
      const res = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }),
      );
      const failed = res.Errors?.filter((e) => e.Code !== "NoSuchKey") ?? [];
      if (failed.length) throw new Error(`Could not delete ${failed.length} object(s): ${failed[0]!.Code} ${failed[0]!.Message ?? ""}`);
    }
  }

  async deletePrefix(prefix: string) {
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : []));
      await this.delete(keys);
      deleted += keys.length;
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }

  /** Create the bucket on first start of a fresh self-hosted install. */
  async ensureBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch (err) {
      if (!(err instanceof S3ServiceException) || err.$metadata.httpStatusCode !== 404) throw err;
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
      } catch (createErr) {
        // The web server and workers start together; if another one created it first, fine.
        if (createErr instanceof S3ServiceException && createErr.name === "BucketAlreadyOwnedByYou") return;
        throw createErr;
      }
    }
  }
}

/** attachment; filename="…" with an RFC 5987 UTF-8 version for names like "Zoë - audio.wav". */
export function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
