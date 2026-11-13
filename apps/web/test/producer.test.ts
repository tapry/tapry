// A producer: a host who is in the call and at the controls, and is never recorded.
import { beforeEach, describe, expect, it } from "vitest";
import { setup } from "./harness";

describe("producer seat", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });
  const as = (token: string) => t.client({ token });
  const state = async () => (await as(t.host.token).get(`/sessions/${t.sessionId}/state`)).body;
  const track = (token: string) =>
    t.call(`/sessions/${t.sessionId}/tracks`, { recordingId: t.recordingId, kind: "audio", mimeType: "audio/webm;codecs=opus", startedAt: t.now() }, token);

  it("is a host's choice, shown to everyone, and their device can't add a track", async () => {
    expect((await state()).participants.map((p: { role: string; producer: boolean }) => [p.role, p.producer])).toEqual([["host", false], ["guest", false]]);
    expect((await as(t.host.token).put(`/sessions/${t.sessionId}/producer`, { producer: true })).status).toBe(200);
    expect((await state()).participants[0]).toMatchObject({ role: "host", producer: true });
    expect(await track(t.host.token)).toMatchObject({ status: 409, body: { error: "not_recorded" } });
    // The guest is recorded as always, and the producer can still stop the recording.
    expect((await track(t.guest.token)).status).toBe(201);
    expect((await as(t.host.token).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`)).status).toBe(200);
  });

  it("isn't for guests", async () => {
    expect((await as(t.guest.token).put(`/sessions/${t.sessionId}/producer`, { producer: true })).status).toBe(403);
  });

  it("can't be switched on while that host is being recorded, and can be switched off again", async () => {
    expect((await track(t.host.token)).status).toBe(201);
    expect(await as(t.host.token).put(`/sessions/${t.sessionId}/producer`, { producer: true })).toMatchObject({ status: 409, body: { error: "recording" } });
    await as(t.host.token).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
    expect((await as(t.host.token).put(`/sessions/${t.sessionId}/producer`, { producer: true })).status).toBe(200);
    expect((await as(t.host.token).put(`/sessions/${t.sessionId}/producer`, { producer: false })).status).toBe(200);
    expect((await state()).participants[0].producer).toBe(false);
  });
});
