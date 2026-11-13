import {
  acceptInviteBody,
  commitChunkBody,
  completeTrackBody,
  confirmStorageCheckBody,
  createStudioBody,
  createTrackBody,
  forgotPasswordBody,
  inviteMemberBody,
  joinBody,
  loginBody,
  ownStorageBody,
  seqParam,
  recapBody,
  resetPasswordBody,
  setFiltersBody,
  aiNotesBody,
  removeWaitlistBody,
  setPlanBody,
  waitlistBody,
  telemetryBody,
  techCheckReport,
  SPEED_TEST_MAX_BYTES,
  signupBody,
  updateStudioBody,
  uploadUrlBody,
  verifyEmailBody,
  type SessionState,
} from "@tapry/shared";
import { downloadZip } from "client-zip";
import { z } from "zod";
import type { User } from "./auth";
import { readWebhook } from "./billing-webhooks";
import { ApiError, isApiError, isZodError } from "./errors";
import type { Participant } from "./live";
import type { Services } from "./services";
import { clientAddress, drainBody, siteCors, speedTestCors } from "./speed-test";
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
      const { user, token } = await svc.auth.signup(await parseBody(req, signupBody), clientAddress(req));
      // Where addresses must be confirmed, the link goes out with the welcome. A limit or a
      // mail problem here never undoes the sign-up: they can ask again from the dashboard.
      await svc.account.sendVerification(user).catch(() => false);
      return withSessionCookie(json(201, { user }), req, token);
    }),
    login: handler(async (svc, req) => {
      checkOrigin(req);
      const { user, token } = await svc.auth.login(await parseBody(req, loginBody), clientAddress(req));
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

    /**
     * Whether this browser is signed in: all the project website learns, so its menu can show
     * "Open studio" instead of Log in and Get Started. The website is another origin on the same
     * site, so the session cookie comes along; only SITE_ORIGINS may read the answer.
     */
    authStatus: handler(async (svc, req) => {
      const user = await svc.auth.userForToken(readCookie(req, SESSION_COOKIE));
      return json(200, { signedIn: !!user }, { ...siteCors(req, svc.siteOrigins, { methods: "GET", credentials: true }), "cache-control": "no-store" });
    }),
    /** The website's waitlist for paid plans. The same answer whether or not the address was already on it. */
    joinWaitlist: handler(async (svc, req) => {
      const cors = siteCors(req, svc.siteOrigins);
      try {
        const body = await parseBody(req, waitlistBody);
        await svc.waitlist.join(body.email, body.plan, clientAddress(req));
        return json(200, { ok: true }, cors);
      } catch (err) {
        const res = errorResponse(err);
        for (const [k, v] of Object.entries(cors)) res.headers.set(k, v); // readable by the website too
        return res;
      }
    }),
    waitlistPreflight: handler(async (svc, req) => new Response(null, { status: 204, headers: siteCors(req, svc.siteOrigins) })),
    adminWaitlist: asUser(async (svc, user) => json(200, { entries: await svc.waitlist.list(user) })),
    adminRemoveWaitlist: asUser(async (svc, user, req) => {
      await svc.waitlist.remove(user, (await parseBody(req, removeWaitlistBody)).email);
      return json(200, { ok: true });
    }),

    /** "I forgot my password": always the same answer, whether or not the address has an account. */
    forgotPassword: handler(async (svc, req) => {
      checkOrigin(req);
      await svc.account.requestReset((await parseBody(req, forgotPasswordBody)).email, clientAddress(req));
      return json(200, { ok: true });
    }),
    /** Set a new password with the emailed link. */
    resetPassword: handler(async (svc, req) => {
      checkOrigin(req);
      const body = await parseBody(req, resetPasswordBody);
      await svc.account.reset(body.token, body.password);
      return json(200, { ok: true });
    }),
    /** Confirm the address with the emailed link. No sign-in needed: the link is the proof. */
    verifyEmail: handler(async (svc, req) => {
      checkOrigin(req);
      await svc.account.verify((await parseBody(req, verifyEmailBody)).token);
      return json(200, { ok: true });
    }),
    /** Send the "confirm your address" email again. */
    sendVerification: asUser(async (svc, user) => json(200, { sent: await svc.account.sendVerification(user) })),

    // ── Studios ────────────────────────────────────────────────────────────────
    listStudios: asUser(async (svc, user) => json(200, { studios: await svc.studios.list(user) })),
    createStudio: asUser(async (svc, user, req) => {
      svc.account.requireVerified(user);
      return json(201, await svc.studios.create(user, await parseBody(req, createStudioBody)));
    }),
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
    openStudio: asUser(async (svc, user, _req, params) => {
      svc.account.requireVerified(user);
      return json(200, await svc.studios.openAsHost(user, params.studioId!));
    }),

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
    processRecording: asUser(async (svc, user, req, params) => {
      // The body is optional: `{ "filters": false }` gives the files as recorded, true puts people's filters back.
      const text = await req.text();
      const { filters } = text.trim() ? processBody.parse(parseJson(text)) : {};
      await svc.processing.processNow(user, params.studioId!, params.recordingId!, { filters });
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
    // ── The dashboard: read-only views across all of the host's studios ─────────
    /** Every recording of the host's, newest first; `?studio=` for one studio, `?limit=` up to 500. */
    listAllRecordings: asUser(async (svc, user, req) => {
      const q = new URL(req.url).searchParams;
      const limit = Number(q.get("limit") ?? "") || undefined;
      return json(200, { recordings: await svc.processing.listForOwner(user, { studioId: q.get("studio") ?? undefined, limit }) });
    }),
    getRecording: asUser(async (svc, user, _req, params) => json(200, await svc.processing.getForOwner(user, params.recordingId!))),
    /** What was said, turn by turn, from the recording's transcript file. */
    recordingTranscript: asUser(async (svc, user, _req, params) =>
      json(200, await svc.library.transcriptTurns(user, params.recordingId!)),
    ),
    /** Each studio with its numbers (recordings, hours, space) and who recorded in it lately. */
    studioCards: asUser(async (svc, user) => json(200, { studios: await svc.library.studioCards(user) })),
    /** Everyone who recorded as a guest, with the newest tech check under their name. */
    listGuests: asUser(async (svc, user) => json(200, { guests: await svc.library.guests(user) })),
    /** Recordings with a transcript; `?q=` searches what was said. */
    listTranscripts: asUser(async (svc, user, req) => {
      const q = new URL(req.url).searchParams.get("q") ?? undefined;
      return json(200, { model: await svc.library.transcriptsModel(), transcripts: await svc.library.transcripts(user, q) });
    }),
    /** Space used; for admins also whether storage answers and how it's set up (never the secret). */
    storageOverview: asUser(async (svc, user) => json(200, await svc.library.storageOverview(user))),
    /** How this server is set up, read-only (admins only; others get 404). */
    workspaceSettings: asUser(async (svc, user) => json(200, await svc.library.workspace(user))),

    // ── Seats: the people in an account ─────────────────────────────────────────
    members: asUser(async (svc, user) => json(200, await svc.members.view(user))),
    /** Invite someone by email (the owner). The link comes back too, to pass on by hand. */
    inviteMember: asUser(async (svc, user, req) =>
      json(201, await svc.members.invite(user, (await parseBody(req, inviteMemberBody)).email, new URL(req.url).origin)),
    ),
    revokeInvite: asUser(async (svc, user, _req, params) => {
      await svc.members.revokeInvite(user, params.inviteId!);
      return new Response(null, { status: 204 });
    }),
    /** The owner removes a member, or a member leaves. */
    removeMember: asUser(async (svc, user, _req, params) => {
      await svc.members.remove(user, params.userId!);
      return new Response(null, { status: 204 });
    }),
    /** What an invitation says, before anyone signs in. */
    invitation: handler(async (svc, _req, params) => {
      const found = await svc.members.invitation(params.token!);
      if (!found) throw new ApiError(404, "invite_not_found", "This invitation has been used, withdrawn or has run out. Ask for a new one.");
      return json(200, found);
    }),
    /** Accept it: a new account for the invited address, or the signed-in person joins. */
    acceptInvite: handler(async (svc, req, params) => {
      checkOrigin(req);
      const signedIn = await svc.auth.userForToken(readCookie(req, SESSION_COOKIE));
      const { token } = await svc.members.accept(params.token!, await parseBody(req, acceptInviteBody), signedIn);
      const res = json(200, { ok: true });
      return token ? withSessionCookie(res, req, token) : res;
    }),

    // ── Own storage: the account's own bucket ───────────────────────────────────
    ownStorage: asUser(async (svc, user) => json(200, await svc.ownStorage.view(user))),
    /** Save a bucket's settings, once this server could write, read and delete there. */
    saveOwnStorage: asUser(async (svc, user, req) => json(200, await svc.ownStorage.save(user, await parseBody(req, ownStorageBody)))),
    removeOwnStorage: asUser(async (svc, user) => json(200, await svc.ownStorage.remove(user))),
    /** A signed test upload for the browser to try, as a guest's browser would. */
    ownStorageCheck: asUser(async (svc, user) => json(200, await svc.ownStorage.browserCheck(user))),
    /** The browser's test upload went through: from now on new sessions record into the bucket. */
    confirmOwnStorageCheck: asUser(async (svc, user, req) =>
      json(200, await svc.ownStorage.confirmBrowserCheck(user, (await parseBody(req, confirmStorageCheckBody)).key)),
    ),

    // ── Tapry Cloud: plans and billing (404 on a self-hosted server) ────────────
    /** The signed-in host's plan, what they have used of it, and where to change it. */
    billing: asUser(async (svc, user) => json(200, await svc.billing.overview(user))),
    /**
     * Open Paddle's customer portal: a session minted for the signed-in account's own customer,
     * then a redirect to it. A form posts here from the Plan tab; problems go back there.
     */
    billingPortal: asUser(async (svc, user) => {
      const back = (code: string) => new Response(null, { status: 303, headers: { location: `/settings?tab=plan&portal=${code}` } });
      if (!svc.paddle?.portalAvailable) throw new ApiError(404, "not_found", "Not found");
      try {
        return new Response(null, { status: 303, headers: { location: await svc.paddle.portalUrl(user), "cache-control": "no-store" } });
      } catch (err) {
        if (isApiError(err)) return back(err.code);
        // Paddle's message can name the customer: its class only.
        console.error(`[billing] portal session failed: ${err instanceof Error ? err.name : "unknown"}`);
        return back("unavailable");
      }
    }),
    /** How AI notes are written for this account. */
    aiNotes: asUser(async (svc, user) => json(200, await svc.notes.view(user))),
    /** The owner allows, or stops allowing, an outside AI model for notes. */
    setAiNotes: asUser(async (svc, user, req) => json(200, await svc.notes.setOutside(user, (await parseBody(req, aiNotesBody)).outside))),
    /** Write a recording's notes now (again), from its transcript. */
    makeNotes: asUser(async (svc, user, _req, params) => {
      await svc.notes.request(user, params.studioId!, params.recordingId!);
      return json(202, { ok: true });
    }),
    /** Accounts and their plans (admins). */
    adminAccounts: asUser(async (svc, user) => json(200, { accounts: await svc.billing.accounts(user) })),
    /** Put an account on a plan by hand: a founding member, an organisation paying by invoice (admins). */
    adminSetPlan: asUser(async (svc, user, req, params) => {
      const body = await parseBody(req, setPlanBody);
      await svc.billing.setPlan(user, params.userId!, body.plan, body.endsAt ? new Date(body.endsAt) : null);
      return json(200, { ok: true });
    }),
    /**
     * The payment provider calls this when a subscription starts, changes or ends. Trusted by
     * its signature alone (no cookie, no origin). The log line says what was done, never whose.
     */
    billingWebhook: handler(async (svc, req) => {
      if (!svc.billing.cloud || !svc.billingWebhook) throw new ApiError(404, "not_found", "Not found");
      // The raw text, exactly as signed: parsing it first would break the signature check.
      const raw = await req.text();
      if (raw.length > 1_000_000) throw new ApiError(413, "too_large", "Webhook body too large");
      if (svc.billingWebhook.provider === "paddle") {
        if (!svc.paddle) throw new ApiError(404, "not_found", "Not found");
        const { type, result } = await svc.paddle.handleWebhook(raw, req.headers.get("paddle-signature"));
        console.log(`[billing] paddle ${type}: ${result}`);
        return json(200, { result });
      }
      let event;
      try {
        event = readWebhook(svc.billingWebhook, raw, req.headers, Date.now());
      } catch (err) {
        if (isApiError(err)) throw err;
        throw new ApiError(400, "bad_webhook", "The webhook's body couldn't be read");
      }
      const result = event ? await svc.billing.apply(event) : "ignored";
      console.log(`[billing] webhook ${event?.status ?? "other"}: ${result}`);
      return json(200, { result });
    }),

    /** The admin health page's checks, as JSON (admins only; others get 404). */
    adminHealth: asUser(async (svc, user) => {
      if (!user.isAdmin) throw new ApiError(404, "not_found", "Not found");
      return json(200, await svc.health.report());
    }),
    /** Who agreed to be recorded in a recording, when, and to which text: a plain-text file. */
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
    /** A person's filters (how they look and sound in their files), for their tracks in the running recording. */
    setFilters: asParticipant(async (svc, p, req) =>
      json(200, await svc.uploads.setFilters(p, (await parseBody(req, setFiltersBody)).filters)),
    ),
    /** The end screen: this participant's own files from the session, and the promo link. */
    ownRecordings: asParticipant(async (svc, p) =>
      json(200, await svc.processing.ownRecordings(p, await svc.billing.promoFor(p.sessionId, svc.guestPromoUrl))),
    ),
    /** The end screen's recap email: whether it's offered and how it's going; asking for one. */
    recapStatus: asParticipant(async (svc, p) => json(200, await svc.recaps.status(p))),
    requestRecap: asParticipant(async (svc, p, req) => json(200, await svc.recaps.request(p, (await parseBody(req, recapBody)).email))),
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be JSON");
  }
}

/** "Process again": with people's filters (true), without (false), or as it was last time (left out). */
const processBody = z.object({ filters: z.boolean().optional() });

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
