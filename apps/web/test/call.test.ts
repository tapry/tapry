import { TokenVerifier } from "livekit-server-sdk";
import { describe, expect, it } from "vitest";
import { CallService } from "../src/server/call";
import { setup } from "./harness";

const config = { url: "ws://localhost:7880", apiKey: "devkey", apiSecret: "a-test-secret-that-is-long-enough-123" };

describe("call tokens", () => {
  it("are off when no LiveKit server is configured", async () => {
    const t = await setup();
    const res = await t.call(`/sessions/${t.sessionId}/call-token`, {});
    expect(res).toMatchObject({ status: 200, body: { enabled: false } });
  });

  it("admit a participant to their own session's room, under their own identity", async () => {
    const t = await setup();
    const call = new CallService(t.db, config);
    const p = await t.services.live.authenticate(t.guest.token, t.sessionId);
    const token = await call.token(p);
    if (!token.enabled) throw new Error("expected an enabled call");
    expect(token).toMatchObject({ url: config.url, room: t.sessionId });

    const claims = await new TokenVerifier(config.apiKey, config.apiSecret).verify(token.token);
    expect(claims).toMatchObject({
      sub: t.guest.participantId,
      name: "Guest",
      video: { room: t.sessionId, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false },
    });
    expect(JSON.parse(claims.metadata!)).toEqual({ role: "guest" });
    // Not a room admin: nobody can kick or mute others through LiveKit directly.
    expect(claims.video?.roomAdmin).toBeFalsy();
    expect(claims.exp! - claims.nbf!).toBe(6 * 60 * 60);
  });

  it("are refused once the session has ended", async () => {
    const t = await setup();
    await t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/end`);
    const call = new CallService(t.db, config);
    const p = await t.services.live.authenticate(t.guest.token, t.sessionId);
    await expect(call.token(p)).rejects.toMatchObject({ status: 409, code: "session_ended" });
  });

  it("need a participant token for that session", async () => {
    const t = await setup();
    expect((await t.call(`/sessions/${t.sessionId}/call-token`, {}, null)).status).toBe(401);
    const otherStudio = (await t.hostBrowser.post("/studios", { name: "Other" })).body;
    const outsider = (await t.hostBrowser.post(`/studios/${otherStudio.id}/open`)).body;
    expect((await t.call(`/sessions/${t.sessionId}/call-token`, {}, outsider.token)).status).toBe(403);
  });
});
