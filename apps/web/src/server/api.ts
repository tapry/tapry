import {
  commitChunkBody,
  completeTrackBody,
  createStudioBody,
  createTrackBody,
  joinBody,
  loginBody,
  seqParam,
  telemetryBody,
  techCheckReport,
  SPEED_TEST_MAX_BYTES,
  signupBody,
  updateStudioBody,
  uploadUrlBody,
  type SessionState,
} from "@tapry/shared";
import { downloadZip } from "client-zip";
import { z } from "zod";
import type { User } from "./auth";
import { ApiError, isApiError, isZodError } from "./errors";
import type { Participant } from "./live";
import type { Services } from "./services";
import { clientAddress, drainBody, speedTestCors } from "./speed-test";
import { APP_VERSION } from "./worker-info";
import { contentDisposition } from "./storage";

type Params = Record<string, string>;
type Handler = (req: Request, params: Params) => Promise<Response>;

export const SESSION_COOKIE = "ot_session";
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
const SSE_PING_MS = 15_000;

/**
 * Every API endpoint as a plain (Request, params) → Response function.
 * Framework-free so tests call them directly; Next.js route files just bind them.
 *
 * Two kinds of caller:
 * - hosts managing studios: `ot_session` cookie (HttpOnly, SameSite=Lax, origin-checked);
 * - anyone inside a session (host or guest): participant bearer token.
 */
export function createApiHandlers(getServices: () => Promise<Services>) {
  const handler =
    (fn: (svc: Services, req: Request, params: Params) => Promise<Response>): Handler =>
    async (req, params) => {
      try {
        return await fn(await getServices(), req, params);
      } catch (err) {
        return errorResponse(err);
      }
    };

  const asUser = (fn: (svc: Services, user: User, req: Request, params: Params) => Promise<Response>) =>
    handler(async (svc, req, params) => {
      if (req.method !== "GET") checkOrigin(req);
      return fn(svc, await svc.auth.requireUser(readCookie(req, SESSION_COOKIE)), req, params);
    });

  const asParticipant = (fn: (svc: Services, p: Participant, req: Request, params: Params) => Promise<Response>) =>
    handler(async (svc, req, params) =>
      fn(svc, await svc.live.authenticate(bearerToken(req), params.sessionId!), req, params),
    );

  return {
    // ── Host accounts ──────────────────────────────────────────────────────────
    signup: handler(async (svc, req) => {
      checkOrigin(req);
      const { user, token } = await svc.auth.signup(await parseBody(req, signupBody));
      return withSessionCookie(json(201, { user }), req, token);
    }),
    login: handler(async (svc, req) => {
      checkOrigin(req);
      const { user, token } = await svc.auth.login(await parseBody(req, loginBody));
      return withSessionCookie(json(200, { user }), req, token);
    }),
    logout: handler(async (svc, req) => {
      checkOrigin(req);
      await svc.auth.logout(readCookie(req, SESSION_COOKIE));
      return withSessionCookie(new Response(null, { status: 204 }), req, "", 0);
    }),
    me: handler(async (svc, req) => {
      const user = await svc.auth.userForToken(readCookie(req, SESSION_COOKIE));
      return user ? json(200, { user }) : json(401, { error: "unauthorized", message: "Not signed in" });
    }),

    // ── Studios ────────────────────────────────────────────────────────────────
    listStudios: asUser(async (svc, user) => json(200, { studios: await svc.studios.list(user) })),
    createStudio: asUser(async (svc, user, req) =>
      json(201, await svc.studios.create(user, await parseBody(req, createStudioBody))),
    ),
    getStudio: asUser(async (svc, user, _req, params) => json(200, await svc.studios.get(user, params.studioId!))),
    updateStudio: asUser(async (svc, user, req, params) =>
      json(200, await svc.studios.update(user, params.studioId!, await parseBody(req, updateStudioBody))),
    ),
    /** Deletes every recording in it (files included) and ends its session. */
    deleteStudio: asUser(async (svc, user, _req, params) => {
      await svc.studios.delete(user, params.studioId!);
      return new Response(null, { status: 204 });
    }),
    rotateInvite: asUser(async (svc, user, _req, params) =>
      json(200, await svc.studios.rotateInvite(user, params.studioId!)),
    ),
    /** Host enters the studio → session ticket (host participant token). */
    openStudio: asUser(async (svc, user, _req, params) =>
      json(200, await svc.studios.openAsHost(user, params.studioId!)),
    ),

    // ── Recordings (host) ─────────────────────────────────────────────────────
    listRecordings: asUser(async (svc, user, _req, params) =>
      json(200, { recordings: await svc.processing.listForStudio(user, params.studioId!) }),
    ),
    /** Removes the recording's files from storage and the list. Not while it records or a worker is on it. */
    deleteRecording: asUser(async (svc, user, _req, params) => {
      await svc.processing.deleteRecording(user, params.studioId!, params.recordingId!);
      return new Response(null, { status: 204 });
    }),
    /** Process now, without tracks that never finished uploading. */
    processRecording: asUser(async (svc, user, _req, params) => {
      await svc.processing.processNow(user, params.studioId!, params.recordingId!);
      return json(202, { queued: true });
    }),
    /** Redirects to a short-lived signed storage URL, so big files never pass through this server. */
    downloadOutput: asUser(async (svc, user, _req, params) => {
      const url = await svc.processing.downloadUrl(user, params.studioId!, params.recordingId!, params.outputId!);
      return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
    }),

    /**
     * Every file of a recording in one zip, streamed from storage as it is read: nothing is
     * built ahead or kept on disk, and the transcript is in it as soon as it exists. Files are
     * stored, not compressed (video and audio don't shrink), so the size is known up front
     * and browsers show real progress. ZIP64, so files over 4 GB are fine.
     */
    /** The admin health page's checks, as JSON (admins only; others get 404). */
    adminHealth: asUser(async (svc, user) => {
      if (!user.isAdmin) throw new ApiError(404, "not_found", "Not found");
      return json(200, await svc.health.report());
    }),
    /** Who agreed to be recorded in an episode, when, and to which text: a plain-text file. */
    consentRecord: asUser(async (svc, user, _req, params) => {
      const { fileName, body } = await svc.processing.consentRecord(user, params.studioId!, params.recordingId!);
      return new Response(body, {
        headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": contentDisposition(fileName), "cache-control": "no-store" },
      });
    }),
    downloadZip: asUser(async (svc, user, req, params) => {
      const { fileName, files, consent } = await svc.processing.zipContents(user, params.studioId!, params.recordingId!);
      const storage = svc.storage;
      const consentBytes = new TextEncoder().encode(consent.body);
      // Opened one at a time, when the zip reaches each file; the consent record goes last.
      async function* entries() {
        for (const f of files) {
          yield { name: f.name, size: f.size, lastModified: f.lastModified, input: await storage.openRead(f.key, req.signal) };
        }
        yield { name: consent.fileName, size: consentBytes.byteLength, lastModified: new Date(), input: consentBytes };
      }
      const metadata = [...files.map((f) => ({ name: f.name, size: f.size })), { name: consent.fileName, size: consentBytes.byteLength }];
      const zip = downloadZip(entries(), { metadata });
      return new Response(zip.body, {
        headers: {
          "content-type": "application/zip",
          "content-length": zip.headers.get("content-length")!,
          "content-disposition": contentDisposition(fileName),
          "cache-control": "no-store",
        },
      });
    }),

    // ── Guests ─────────────────────────────────────────────────────────────────
    join: handler(async (svc, req) => json(201, await svc.studios.join(await parseBody(req, joinBody)))),
    /** Tech check: test data for the upload-speed check, read and thrown away. */
    speedTest: handler(async (svc, req, params) =>
      json(200, await svc.studios.speedTest(params.inviteCode!, req.body, SPEED_TEST_MAX_BYTES)),
    ),
    /**
     * Public upload-speed test (no account): throwaway bytes, read and dropped, limited per
     * address. The project website may call it from its origin (SPEED_TEST_ORIGINS).
     */
    publicSpeedTest: handler(async (svc, req) => {
      const cors = speedTestCors(req, svc.speedTest.origins);
      const key = clientAddress(req);
      const allowed = Math.min(SPEED_TEST_MAX_BYTES, svc.speedTest.limiter.remaining(key));
      if (allowed === 0) {
        await req.body?.cancel().catch(() => {});
        return json(429, { error: "slow_down", message: "Too many speed tests from your address. Try again in a minute." }, cors);
      }
      try {
        const bytes = await drainBody(req.body, allowed);
        svc.speedTest.limiter.record(key, bytes);
        return json(200, { bytes }, cors);
      } catch (err) {
        svc.speedTest.limiter.record(key, allowed);
        if (!isApiError(err)) throw err;
        return json(err.status, { error: err.code, message: err.message }, cors); // readable by the website too
      }
    }),
    publicSpeedTestPreflight: handler(async (svc, req) => new Response(null, { status: 204, headers: speedTestCors(req, svc.speedTest.origins) })),
    /** Tech check: the guest sends their results to the host. */
    reportTechCheck: handler(async (svc, req, params) => {
      await svc.studios.reportTechCheck(params.inviteCode!, await parseBody(req, techCheckReport));
      return new Response(null, { status: 204 });
    }),

    // ── Live session ───────────────────────────────────────────────────────────
    time: handler(async (svc) => json(200, { serverTime: svc.live.serverTime() })),
    /** Liveness for Docker / load balancers: services built, migrations applied, database answering. */
    health: handler(async (svc) => {
      await svc.db.query("SELECT 1");
      return json(200, { ok: true, version: APP_VERSION });
    }),
    sessionState: asParticipant(async (svc, p) => json(200, await svc.live.state(p.sessionId))),
    sessionEvents: asParticipant(async (svc, p, req) => sseResponse(req, (send) => svc.live.subscribe(p.sessionId, send))),
    startRecording: asParticipant(async (svc, p) => json(201, await svc.live.startRecording(p))),
    stopRecording: asParticipant(async (svc, p, _req, params) =>
      json(200, await svc.live.stopRecording(p, params.recordingId!)),
    ),
    endSession: asParticipant(async (svc, p) => json(200, await svc.live.endSession(p))),
    /** A device's quality report: alert codes and upload lag, no media. Every few seconds. */
    telemetry: asParticipant(async (svc, p, req) => {
      svc.live.reportHealth(p, await parseBody(req, telemetryBody));
      return new Response(null, { status: 204 });
    }),
    /** The end screen: this participant's own files from the session, and the promo link. */
    ownRecordings: asParticipant(async (svc, p) => json(200, await svc.processing.ownRecordings(p, svc.guestPromoUrl))),
    /** LiveKit token for the live call (or enabled: false when no LiveKit is configured). */
    callToken: asParticipant(async (svc, p) => json(200, await svc.call.token(p))),

    // ── Chunk uploads (docs/decisions/0001-one-object-per-chunk.md) ────────────
    createTrack: asParticipant(async (svc, p, req) =>
      json(201, await svc.uploads.createTrack(p, await parseBody(req, createTrackBody))),
    ),
    uploadUrl: asParticipant(async (svc, p, req, params) =>
      json(200, await svc.uploads.createUploadUrl(p, params.trackId!, parseSeq(params), await parseBody(req, uploadUrlBody))),
    ),
    commitChunk: asParticipant(async (svc, p, req, params) =>
      json(200, await svc.uploads.commitChunk(p, params.trackId!, parseSeq(params), await parseBody(req, commitChunkBody))),
    ),
    completeTrack: asParticipant(async (svc, p, req, params) =>
      json(200, await svc.uploads.completeTrack(p, params.trackId!, await parseBody(req, completeTrackBody))),
    ),
  };
}

export type ApiHandlers = ReturnType<typeof createApiHandlers>;

/** Server-Sent Events stream of `state` snapshots, with keep-alive pings. Ends when the client disconnects. */
function sseResponse(req: Request, subscribe: (send: (s: SessionState) => void) => Promise<() => void>) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      // Tell EventSource-style clients to reconnect quickly; every reconnect starts with a full snapshot.
      write("retry: 2000\n\n");
      const unsubscribe = await subscribe((state) => write(`event: state\ndata: ${JSON.stringify(state)}\n\n`));
      const ping = setInterval(() => write(": ping\n\n"), SSE_PING_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      req.signal.addEventListener("abort", () => cleanup(), { once: true });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no", // stop reverse proxies from buffering the stream
    },
  });
}

// ── Request helpers ───────────────────────────────────────────────────────────

function bearerToken(req: Request) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  return match?.[1];
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * Cookie-authenticated writes must come from our own pages. SameSite=Lax already keeps the
 * cookie off cross-site POSTs; this also rejects any browser request whose Origin isn't us.
 */
function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, tests) don't send one
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "bad_origin", "Cross-origin request refused");
  }
  if (originHost !== host) throw new ApiError(403, "bad_origin", "Cross-origin request refused");
}

function isHttps(req: Request) {
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

function withSessionCookie(res: Response, req: Request, token: string, maxAge = SESSION_MAX_AGE_S) {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isHttps(req)) attrs.push("Secure");
  res.headers.append("set-cookie", attrs.join("; "));
  return res;
}

async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be JSON");
  }
  return schema.parse(raw);
}

function parseSeq(params: Params) {
  const seq = seqParam.safeParse(params.seq);
  if (!seq.success) throw new ApiError(400, "invalid_seq", "seq must be a non-negative integer");
  return seq.data;
}

function json(status: number, body: unknown, headers?: Record<string, string>) {
  return Response.json(body, { status, headers });
}

function errorResponse(err: unknown) {
  if (isApiError(err)) return json(err.status, { error: err.code, message: err.message });
  if (isZodError(err)) {
    return json(400, { error: "invalid_body", issues: err.issues.map((i) => ({ path: i.path, message: i.message })) });
  }
  // Metadata only — never request bodies or media.
  console.error("[api] unhandled error", err);
  return json(500, { error: "internal", message: "Internal server error" });
}
