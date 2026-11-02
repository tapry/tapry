import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionState } from "@tapry/shared";
import { describe, expect, it } from "vitest";
import { ROUTES } from "../src/server/routes";
import { createServer, expectOk, setup } from "./harness";

const PASSWORD = "correct horse battery";

async function signedInHost(server: Awaited<ReturnType<typeof createServer>>, email = "host@example.com") {
  const browser = server.client();
  await expectOk(browser.post("/auth/signup", { email, name: "Host", password: PASSWORD }));
  return browser;
}

describe("host accounts", () => {
  it("makes the first account admin, then closes sign-up", async () => {
    const server = await createServer();
    const first = server.client();
    const res = await first.post("/auth/signup", { email: "  Admin@Example.com ", name: "Ada", password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "admin@example.com", name: "Ada", isAdmin: true });
    expect(res.headers.get("set-cookie")).toMatch(/^ot_session=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);

    const second = await server.client().post("/auth/signup", { email: "b@example.com", name: "B", password: PASSWORD });
    expect(second.status).toBe(403);
    expect(second.body.error).toBe("signup_closed");
  });

  it("lets more people sign up when ALLOW_SIGNUP is on, never as admin", async () => {
    const server = await createServer(undefined, { allowSignup: true });
    await signedInHost(server, "a@example.com");
    const b = await server.client().post("/auth/signup", { email: "b@example.com", name: "B", password: PASSWORD });
    expect(b.body.user.isAdmin).toBe(false);
    const dup = await server.client().post("/auth/signup", { email: "B@example.com", name: "B2", password: PASSWORD });
    expect(dup.body.error).toBe("email_taken");
  });

  it("rejects short passwords and bad emails", async () => {
    const server = await createServer();
    const res = await server.client().post("/auth/signup", { email: "nope", name: "X", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.issues.map((i: { path: string[] }) => i.path[0]).sort()).toEqual(["email", "password"]);
  });

  it("logs in, reports the user, and logs out", async () => {
    const server = await createServer();
    await signedInHost(server);
    const browser = server.client();
    expect((await browser.get("/auth/me")).status).toBe(401);

    expect((await browser.post("/auth/login", { email: "host@example.com", password: PASSWORD })).status).toBe(200);
    expect((await browser.get("/auth/me")).body.user.email).toBe("host@example.com");

    expect((await browser.post("/auth/logout")).status).toBe(204);
    expect(browser.jar.size).toBe(0);
    expect((await browser.get("/studios")).status).toBe(401);
  });

  it("invalidates the session server-side on logout, not just the cookie", async () => {
    const server = await createServer();
    const browser = await signedInHost(server);
    const stolen = browser.jar.get("ot_session")!;
    await browser.post("/auth/logout");
    const thief = server.client();
    thief.jar.set("ot_session", stolen);
    expect((await thief.get("/auth/me")).status).toBe(401);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const server = await createServer();
    await signedInHost(server);
    const wrong = await server.client().post("/auth/login", { email: "host@example.com", password: "wrong password" });
    const unknown = await server.client().post("/auth/login", { email: "who@example.com", password: "wrong password" });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it("locks out an email after repeated failures", async () => {
    const server = await createServer();
    await signedInHost(server);
    for (let i = 0; i < 10; i++) await server.client().post("/auth/login", { email: "host@example.com", password: "nope" });
    const res = await server.client().post("/auth/login", { email: "host@example.com", password: PASSWORD });
    expect(res.status).toBe(429);
    server.tick(16 * 60 * 1000);
    expect((await server.client().post("/auth/login", { email: "host@example.com", password: PASSWORD })).status).toBe(200);
  });

  it("expires login sessions", async () => {
    const server = await createServer();
    const browser = await signedInHost(server);
    server.tick(31 * 24 * 60 * 60 * 1000);
    expect((await browser.get("/auth/me")).status).toBe(401);
  });

  it("refuses cookie-authenticated writes from another origin", async () => {
    const server = await createServer();
    const browser = await signedInHost(server);
    const evil = await browser.post("/studios", { name: "X" }, { origin: "https://evil.example" });
    expect(evil).toMatchObject({ status: 403, body: { error: "bad_origin" } });
    const ours = await browser.post("/studios", { name: "X" }, { origin: "https://app.test" });
    expect(ours.status).toBe(201);
  });

  it("does not store passwords or session tokens in the clear", async () => {
    const server = await createServer();
    const browser = await signedInHost(server);
    const dump = JSON.stringify([
      await server.db.query("SELECT * FROM users"),
      await server.db.query("SELECT * FROM user_sessions"),
    ]);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain(browser.jar.get("ot_session"));
  });
});

describe("studios", () => {
  it("creates, lists, updates studios with validated settings", async () => {
    const server = await createServer();
    const browser = await signedInHost(server);
    const created = await browser.post("/studios", { name: "Weekly Show", settings: { maxGuests: 2 } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^std_/),
      name: "Weekly Show",
      inviteCode: expect.stringMatching(/^[\w-]{22}$/),
      settings: { videoQuality: "1080p", maxGuests: 2, echoCancellation: true, levelLoudness: true, audioOnly: false },
    });
    const id = created.body.id;

    const updated = await browser.patch(`/studios/${id}`, { settings: { echoCancellation: false, levelLoudness: false } });
    expect(updated.body.settings).toEqual({
      videoQuality: "1080p",
      maxGuests: 2,
      echoCancellation: false,
      levelLoudness: false,
      audioOnly: false,
      guestDownloads: true,
      consentText: "",
      audioFormat: "wav",
    });
    expect(updated.body.name).toBe("Weekly Show");

    expect((await browser.patch(`/studios/${id}`, { settings: { maxGuests: 50 } })).status).toBe(400);
    expect((await browser.get("/studios")).body.studios.map((s: { id: string }) => s.id)).toEqual([id]);
  });

  it("keeps each host's studios private", async () => {
    const server = await createServer(undefined, { allowSignup: true });
    const alice = await signedInHost(server, "alice@example.com");
    const bob = await signedInHost(server, "bob@example.com");
    const studio = (await alice.post("/studios", { name: "Alice's" })).body;

    expect((await bob.get(`/studios/${studio.id}`)).status).toBe(404);
    expect((await bob.post(`/studios/${studio.id}/open`)).status).toBe(404);
    expect((await bob.patch(`/studios/${studio.id}`, { name: "mine now" })).status).toBe(404);
    expect((await bob.get("/studios")).body.studios).toEqual([]);
  });

  it("reuses the open session when the host comes back, and replaces their token", async () => {
    const server = await createServer();
    const browser = await signedInHost(server);
    const studio = (await browser.post("/studios", { name: "S" })).body;
    const first = (await browser.post(`/studios/${studio.id}/open`)).body;
    const second = (await browser.post(`/studios/${studio.id}/open`)).body;

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.participantId).toBe(first.participantId);
    expect(second.role).toBe("host");
    const state = (sid: string, token: string) => server.client({ token }).get(`/sessions/${sid}/state`);
    expect((await state(first.sessionId, first.token)).status).toBe(401);
    expect((await state(first.sessionId, second.token)).status).toBe(200);
  });
});

describe("guests joining", () => {
  async function openStudio(settings?: object) {
    const server = await createServer();
    const browser = await signedInHost(server);
    const studio = (await browser.post("/studios", { name: "S", settings })).body;
    return { server, browser, studio };
  }

  const joinAs = (server: Awaited<ReturnType<typeof createServer>>, inviteCode: string, displayName = "Guest") =>
    server.client().post("/join", { inviteCode, displayName, consent: true });

  it("needs the host to have opened the studio", async () => {
    const { server, studio } = await openStudio();
    expect((await joinAs(server, studio.inviteCode)).body.error).toBe("host_not_here");
  });

  it("joins the open session with consent recorded", async () => {
    const { server, browser, studio } = await openStudio();
    const host = (await browser.post(`/studios/${studio.id}/open`)).body;
    const res = await joinAs(server, studio.inviteCode, "Sam");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sessionId: host.sessionId,
      role: "guest",
      token: expect.any(String),
      studio: { name: "S", settings: { maxGuests: 3 } },
    });
    const [row] = await server.db.query<any>("SELECT display_name, consented_at FROM participants WHERE id = $1", [
      res.body.participantId,
    ]);
    expect(row.display_name).toBe("Sam");
    expect(row.consented_at).toBeInstanceOf(Date);
  });

  it("requires consent to be recorded", async () => {
    const { server, browser, studio } = await openStudio();
    await browser.post(`/studios/${studio.id}/open`);
    const res = await server.client().post("/join", { inviteCode: studio.inviteCode, displayName: "Sam", consent: false });
    expect(res.status).toBe(400);
    expect(res.body.issues[0].message).toMatch(/consent/i);
  });

  it("enforces the guest limit", async () => {
    const { server, browser, studio } = await openStudio({ maxGuests: 1 });
    await browser.post(`/studios/${studio.id}/open`);
    expect((await joinAs(server, studio.inviteCode)).status).toBe(201);
    expect((await joinAs(server, studio.inviteCode)).body.error).toBe("studio_full");
  });

  it("stops accepting the old invite link after rotation", async () => {
    const { server, browser, studio } = await openStudio();
    await browser.post(`/studios/${studio.id}/open`);
    const rotated = (await browser.post(`/studios/${studio.id}/invite`)).body;
    expect(rotated.inviteCode).not.toBe(studio.inviteCode);
    expect((await joinAs(server, studio.inviteCode)).body.error).toBe("invite_not_found");
    expect((await joinAs(server, rotated.inviteCode)).status).toBe(201);
  });

  it("starts a new session after the host ends the old one", async () => {
    const { server, browser, studio } = await openStudio();
    const host = (await browser.post(`/studios/${studio.id}/open`)).body;
    const guest = (await joinAs(server, studio.inviteCode)).body;
    await server.client({ token: host.token }).post(`/sessions/${host.sessionId}/end`);

    expect((await joinAs(server, studio.inviteCode)).body.error).toBe("host_not_here");
    const next = (await browser.post(`/studios/${studio.id}/open`)).body;
    expect(next.sessionId).not.toBe(host.sessionId);
    // The old guest token belongs to the old session only.
    expect((await server.client({ token: guest.token }).get(`/sessions/${next.sessionId}/state`)).status).toBe(403);
  });
});

describe("recording control", () => {
  it("starts and stops recordings with server timestamps", async () => {
    const t = await setup();
    const host = t.client({ token: t.host.token });
    const state = (await host.get(`/sessions/${t.sessionId}/state`)).body as SessionState;
    expect(state.recording).toEqual({ id: t.recordingId, status: "recording", startedAt: 1_000_000, stoppedAt: null });
    expect(state.participants.map((p) => [p.displayName, p.role])).toEqual([
      ["Host", "host"],
      ["Guest", "guest"],
    ]);

    t.tick(60_000);
    const stopped = await host.post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
    expect(stopped.body.recording).toMatchObject({ status: "stopped", stoppedAt: 1_060_000 });

    // Stop is idempotent and keeps the first stop time.
    t.tick(5_000);
    const again = await host.post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
    expect(again.body.recording.stoppedAt).toBe(1_060_000);

    const take2 = await host.post(`/sessions/${t.sessionId}/recordings`);
    expect(take2.status).toBe(201);
    expect(take2.body.recording).toMatchObject({ status: "recording", startedAt: 1_065_000 });
    expect(take2.body.recording.id).not.toBe(t.recordingId);
  });

  it("allows only one running recording per session", async () => {
    const t = await setup();
    const res = await t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings`);
    expect(res).toMatchObject({ status: 409, body: { error: "already_recording" } });
  });

  it("lets only the host control recording", async () => {
    const t = await setup();
    const guest = t.client({ token: t.guest.token });
    expect((await guest.post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`)).body.error).toBe("host_only");
    expect((await guest.post(`/sessions/${t.sessionId}/end`)).body.error).toBe("host_only");
  });

  it("ending the session stops the running recording and blocks new ones", async () => {
    const t = await setup();
    const host = t.client({ token: t.host.token });
    const ended = (await host.post(`/sessions/${t.sessionId}/end`)).body as SessionState;
    expect(ended.session.status).toBe("ended");
    expect(ended.recording?.status).toBe("stopped");
    expect((await host.post(`/sessions/${t.sessionId}/recordings`)).body.error).toBe("session_ended");
  });

  it("exposes the server clock for offset estimation", async () => {
    const t = await setup();
    expect((await t.client().get("/time")).body).toEqual({ serverTime: 1_000_000 });
  });
});

describe("session events (SSE)", () => {
  /** Reads `event: state` messages from an SSE response. */
  function sseReader(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    return async function next(): Promise<SessionState> {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const message = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = /^event: state\ndata: (.*)$/m.exec(message);
          if (data) return JSON.parse(data[1]!);
          continue; // retry: / ping
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buffer += decoder.decode(value, { stream: true });
      }
    };
  }

  const subscribe = async (t: Awaited<ReturnType<typeof setup>>, token: string, signal?: AbortSignal) => {
    const res = await t.fetchFor()(`https://app.test/api/sessions/${t.sessionId}/events`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    return sseReader(res);
  };

  it("sends the current state first, then every change, to everyone in the session", async () => {
    const t = await setup();
    const guestEvents = await subscribe(t, t.guest.token);
    const hostEvents = await subscribe(t, t.host.token);

    expect((await guestEvents()).recording?.status).toBe("recording");
    expect((await hostEvents()).recording?.status).toBe("recording");

    await t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
    expect((await guestEvents()).recording?.status).toBe("stopped");
    expect((await hostEvents()).recording?.status).toBe("stopped");

    await t.client().post("/join", { inviteCode: t.studio.inviteCode, displayName: "Late", consent: true });
    expect((await guestEvents()).participants.map((p) => p.displayName)).toContain("Late");
  });

  it("does not leak events across sessions", async () => {
    const t = await setup();
    const other = (await t.hostBrowser.post("/studios", { name: "Other" })).body;
    const otherHost = (await t.hostBrowser.post(`/studios/${other.id}/open`)).body;

    const events = await subscribe(t, t.guest.token);
    await events(); // initial snapshot
    await t.client({ token: otherHost.token }).post(`/sessions/${otherHost.sessionId}/recordings`);
    await t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/end`);
    const next = await events();
    expect(next.session.id).toBe(t.sessionId);
    expect(next.session.status).toBe("ended");
  });

  it("requires a participant token and unsubscribes when the client disconnects", async () => {
    const t = await setup();
    const anonymous = await t.fetchFor()(`https://app.test/api/sessions/${t.sessionId}/events`);
    expect(anonymous.status).toBe(401);

    const abort = new AbortController();
    const events = await subscribe(t, t.guest.token, abort.signal);
    await events();
    const listeners = () => (t.services.live as unknown as { hub: { listeners: Map<string, Set<unknown>> } }).hub.listeners;
    expect(listeners().get(t.sessionId)?.size).toBe(1);
    abort.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(listeners().has(t.sessionId)).toBe(false);
  });
});

describe("route files", () => {
  it("has a Next.js route.ts bound to the right handler for every entry in ROUTES", () => {
    for (const [method, path, name] of ROUTES) {
      const file = join(__dirname, "../src/app", path, "route.ts");
      expect(existsSync(file), `${file} is missing`).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source, `${path} should export ${method} → api.${name}`).toMatch(
        new RegExp(`export async function ${method}\\([^)]*\\) \\{\\n  return api\\.${name}\\(`),
      );
    }
  });
});
