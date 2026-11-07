// What one guest's token may do: upload within the recording's window and a sane amount, and
// nothing that could fail everyone's files or fill the disk. Plus who may create accounts.
import { chunkStorageKey } from "@tapry/shared";
import { describe, expect, it } from "vitest";
import { AuthService } from "../src/server/auth";
import { MAX_TRACKS_PER_PERSON, UPLOAD_GRACE_DAYS } from "../src/server/uploads";
import { createServer, expectOk, FakeStorage, setup, sha256 } from "./harness";

const MIME = "audio/webm;codecs=opus";
const DAY = 86_400_000;

async function guestTrack(t: Awaited<ReturnType<typeof setup>>, over: Record<string, unknown> = {}) {
  return t.call(`/sessions/${t.sessionId}/tracks`, { recordingId: t.recordingId, kind: "audio", mimeType: MIME, startedAt: t.now(), ...over });
}

describe("a track's time window", () => {
  it("refuses a track that began before the recording, beyond clock slack", async () => {
    const t = await setup();
    expect((await guestTrack(t, { startedAt: t.now() - 5_000 })).status).toBe(201);
    const early = await guestTrack(t, { startedAt: t.now() - 60_000 });
    expect(early.status).toBe(409);
    expect(early.body.error).toBe("track_too_early");
  });

  it(`takes uploads for ${UPLOAD_GRACE_DAYS} days after Stop, then no more (and never says 410, so devices keep their copy)`, async () => {
    const t = await setup();
    const { trackId } = (await expectOk(guestTrack(t))).body;
    await expectOk(t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
    t.tick(UPLOAD_GRACE_DAYS * DAY - 60_000);
    const data = Buffer.from("late but fine");
    const meta = { bytes: data.length, sha256: sha256(data) };
    expect((await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/upload-url`, { ...meta, mimeType: MIME })).status).toBe(200);

    t.tick(2 * 60_000);
    for (const [path, body] of [
      [`/tracks/${trackId}/chunks/1/upload-url`, { ...meta, mimeType: MIME }],
      [`/tracks/${trackId}/chunks/0/commit`, { ...meta, startTs: t.now(), endTs: t.now() }],
      [`/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq: 0 }],
    ] as const) {
      const res = await t.call(`/sessions/${t.sessionId}${path}`, body);
      expect(res.status, path).toBe(409);
      expect(res.body.error, path).toBe("recording_closed");
    }
    const stopped = t.now() - UPLOAD_GRACE_DAYS * DAY - 60_000;
    expect((await guestTrack(t, { startedAt: stopped })).body.error).toBe("recording_closed");
  });
});

describe("how much one person may upload", () => {
  it(`allows ${MAX_TRACKS_PER_PERSON} tracks per person and recording, and still a retry of a known one`, async () => {
    const t = await setup();
    let last = "";
    for (let i = 0; i < MAX_TRACKS_PER_PERSON; i++) last = (await expectOk(guestTrack(t))).body.trackId;
    const more = await guestTrack(t);
    expect(more.status).toBe(429);
    expect(more.body.error).toBe("too_many_tracks");
    expect((await guestTrack(t, { trackId: last })).status).toBe(201); // the same registration again
  });

  it("caps bytes by the recording's length, so a guest can't fill the disk", async () => {
    const storage = new FakeStorage();
    const t = await setup(storage, { bytesPerSecondCap: 1 }); // 1 byte per second + 600 s of slack = 600 bytes
    const { trackId } = (await expectOk(guestTrack(t))).body;
    const put = async (seq: number, text: string) => {
      const meta = { bytes: text.length, sha256: sha256(text) };
      const res = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/upload-url`, { ...meta, mimeType: MIME });
      if (res.status === 200) {
        storage.put(chunkStorageKey(t.sessionId, trackId, seq), text);
        await expectOk(t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/commit`, { ...meta, startTs: t.now(), endTs: t.now() }));
      }
      return res;
    };
    expect((await put(0, "x".repeat(400))).status).toBe(200);
    const over = await put(1, "x".repeat(300));
    expect(over.status).toBe(413);
    expect(over.body.error).toBe("upload_quota");
    expect((await put(1, "x".repeat(150))).status).toBe(200);
    // A longer recording allows more.
    t.tick(1000 * 1000);
    expect((await put(2, "x".repeat(900))).status).toBe(200);
  });

  it("refuses a completion that claims thousands of chunks beyond what arrived", async () => {
    const t = await setup();
    const { trackId } = (await expectOk(guestTrack(t))).body;
    const huge = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq: 1_000_000 });
    expect(huge.status).toBe(400);
    expect(huge.body.error).toBe("last_seq_too_high");
    expect((await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq: 3 })).status).toBe(200);
  });
});

describe("names people type", () => {
  it("can't carry line breaks or invisible characters (they'd forge lines in the consent record)", async () => {
    const t = await setup();
    const join = (displayName: string) => t.client().post("/join", { inviteCode: t.studio.inviteCode, displayName, consent: true });
    expect((await join("Ana\nHost (host): agreed")).status).toBe(400);
    expect((await join("Ana​Guest")).status).toBe(400);
    expect((await join("Ana García-Núñez, PhD")).status).toBe(201);
    expect((await t.hostBrowser.post("/studios", { name: "Line\rbreak" })).status).toBe(400);
  });
});

describe("who may create accounts", () => {
  it("needs the install's setup code for the first account when the server has one", async () => {
    const s = await createServer(new FakeStorage(), { setupToken: "correct-horse-battery" });
    const signup = (extra: Record<string, unknown>) => s.client().post("/auth/signup", { email: "a@b.test", name: "A", password: "long enough pass", ...extra });
    expect((await signup({})).body.error).toBe("setup_token_required");
    expect((await signup({ setupToken: "wrong" })).body.error).toBe("setup_token_required");
    expect((await signup({ setupToken: "correct-horse-battery" })).status).toBe(201);
    // Afterwards the code is no help: sign-up is closed.
    expect((await s.client().post("/auth/signup", { email: "c@d.test", name: "C", password: "long enough pass", setupToken: "correct-horse-battery" })).body.error).toBe("signup_closed");
    expect(s.services.auth.setupRequired).toBe(true);
  });

  it("works as before without one", async () => {
    const s = await createServer();
    expect(s.services.auth.setupRequired).toBe(false);
    expect((await s.client().post("/auth/signup", { email: "a@b.test", name: "A", password: "long enough pass" })).status).toBe(201);
  });

  it("limits failed logins per address across emails, and forgets idle addresses", async () => {
    const s = await createServer();
    let clock = 0;
    const auth = new AuthService(s.db, { allowSignup: false, maxFailuresPerAddress: 5, now: () => clock });
    const attempt = (email: string, address: string) => auth.login({ email, password: "nope nope nope" }, address).catch((e: { code: string }) => e.code);
    for (let i = 0; i < 5; i++) expect(await attempt(`u${i}@x.test`, "10.0.0.1")).toBe("invalid_credentials");
    expect(await attempt("fresh@x.test", "10.0.0.1")).toBe("too_many_attempts");
    expect(await attempt("fresh@x.test", "10.0.0.2")).toBe("invalid_credentials"); // another address is fine
    clock += 16 * 60_000;
    expect(await attempt("fresh@x.test", "10.0.0.1")).toBe("invalid_credentials"); // the window has passed
  });
});
