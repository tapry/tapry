import { describe, expect, it } from "vitest";
import { extensionFor, pickMimeType } from "../src/codecs.js";
import { createHttpTransport, HttpError } from "../src/http-transport.js";
import { isTrackGone } from "../src/types.js";
import type { StoredChunk } from "../src/types.js";
import { bytes } from "./fakes.js";

describe("pickMimeType", () => {
  const supports = (...types: string[]) => (t: string) => types.includes(t);

  it("prefers WebM VP9 where available (Chromium)", () => {
    expect(pickMimeType("video", supports("video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus"))).toBe(
      "video/webm;codecs=vp9,opus",
    );
  });

  it("falls back to MP4 (Safari)", () => {
    expect(pickMimeType("video", supports("video/mp4"))).toBe("video/mp4");
    expect(pickMimeType("audio", supports("audio/mp4;codecs=mp4a.40.2", "audio/mp4"))).toBe(
      "audio/mp4;codecs=mp4a.40.2",
    );
  });

  it("picks a picture-only format for a mask track: WebM VP8, else VP9, else MP4 (Safari)", () => {
    expect(pickMimeType("mask", supports("video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm;codecs=vp9,opus"))).toBe("video/webm;codecs=vp8");
    expect(pickMimeType("mask", supports("video/webm;codecs=vp9", "video/mp4"))).toBe("video/webm;codecs=vp9");
    expect(pickMimeType("mask", supports("video/mp4;codecs=avc1.42E01E", "video/mp4"))).toBe("video/mp4;codecs=avc1.42E01E");
    expect(() => pickMimeType("mask", supports("audio/webm"))).toThrow(/No supported/);
  });

  it("throws when nothing is supported", () => {
    expect(() => pickMimeType("audio", () => false)).toThrow(/No supported/);
  });

  it("maps mime types to file extensions", () => {
    expect(extensionFor("video/webm;codecs=vp9,opus")).toBe("webm");
    expect(extensionFor("video/mp4")).toBe("mp4");
    expect(extensionFor("audio/mp4;codecs=mp4a.40.2")).toBe("m4a");
    expect(extensionFor("audio/ogg;codecs=opus")).toBe("ogg");
  });
});

describe("createHttpTransport", () => {
  const data = bytes("chunk bytes");
  const chunk: StoredChunk = { sessionId: "s 1", trackId: "t1", seq: 7, startTs: 10, endTs: 20, bytes: 11, data };
  const sha256 = "37ffb76514cf33b575c36f7a961baba836d59e699cd640e3f36aa960855e7d71";

  function mockFetch(putStatus = 200) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/upload-url")) {
        return new Response(JSON.stringify({ url: "https://s3.test/bucket/key?X-Amz-Signature=secret" }));
      }
      if (url.startsWith("https://s3.test")) return new Response(null, { status: putStatus });
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;
    return { fetch, calls };
  }

  it("gets an upload URL, PUTs the bytes, then commits with a checksum", async () => {
    const { fetch, calls } = mockFetch();
    const transport = createHttpTransport({
      baseUrl: "https://app.test/api/",
      fetch,
      headers: () => ({ authorization: "Bearer guest-token" }),
    });
    await transport.uploadChunk(chunk, "video/webm");

    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "POST https://app.test/api/sessions/s%201/tracks/t1/chunks/7/upload-url",
      "PUT https://s3.test/bucket/key?X-Amz-Signature=secret",
      "POST https://app.test/api/sessions/s%201/tracks/t1/chunks/7/commit",
    ]);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ bytes: 11, mimeType: "video/webm", sha256 });
    expect(calls[1]!.init.body).toBe(data);
    expect(calls[1]!.init.headers).not.toHaveProperty("authorization"); // never leak auth to storage
    expect(calls[2]!.init.headers).toHaveProperty("authorization", "Bearer guest-token");
    expect(JSON.parse(calls[2]!.init.body as string)).toEqual({ bytes: 11, startTs: 10, endTs: 20, sha256 });
  });

  it("fails without committing when the storage PUT fails, and keeps the signature out of the error", async () => {
    const { fetch, calls } = mockFetch(503);
    const transport = createHttpTransport({ baseUrl: "https://app.test/api", fetch });
    const err = await transport.uploadChunk(chunk, "video/webm").catch((e) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(503);
    expect(err.message).not.toContain("secret");
    expect(calls.some((c) => c.url.endsWith("/commit"))).toBe(false);
  });

  it("turns 410 Gone from the API into TrackGoneError, but not a 410 from storage", async () => {
    const gone = (async () => new Response(null, { status: 410 })) as typeof globalThis.fetch;
    const err = await createHttpTransport({ baseUrl: "https://app.test/api", fetch: gone }).uploadChunk(chunk, "video/webm").catch((e) => e);
    expect(isTrackGone(err)).toBe(true);

    const { fetch } = mockFetch(410); // the presigned PUT answers 410
    const putErr = await createHttpTransport({ baseUrl: "https://app.test/api", fetch }).uploadChunk(chunk, "video/webm").catch((e) => e);
    expect(isTrackGone(putErr)).toBe(false);
    expect(putErr).toBeInstanceOf(HttpError);
  });

  it("skips the PUT and commit when the server already has the chunk", async () => {
    const calls: string[] = [];
    const fetch = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ committed: true }));
    }) as typeof globalThis.fetch;
    await createHttpTransport({ baseUrl: "https://app.test/api", fetch }).uploadChunk(chunk, "video/webm");
    expect(calls).toEqual(["https://app.test/api/sessions/s%201/tracks/t1/chunks/7/upload-url"]);
  });

  it("posts track completion", async () => {
    const { fetch, calls } = mockFetch();
    const transport = createHttpTransport({ baseUrl: "https://app.test/api", fetch });
    const info = {
      sessionId: "s1",
      trackId: "t1",
      kind: "audio" as const,
      mimeType: "audio/webm",
      startedAt: 0,
      stoppedAt: 9,
      lastSeq: 3,
    };
    await transport.completeTrack(info);
    expect(calls[0]!.url).toBe("https://app.test/api/sessions/s1/tracks/t1/complete");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(info);
  });
});
