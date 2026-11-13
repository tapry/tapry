// Solo links: one person records alone on a studio's link, starting and stopping it themselves.
import { beforeEach, describe, expect, it } from "vitest";
import { SOLO_JOINS_PER_ADDRESS } from "../src/server/studios";
import { setup } from "./harness";

const ORIGIN = { origin: "https://app.test" };

describe("solo links", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let code: string;
  beforeEach(async () => {
    t = await setup();
    await t.hostBrowser.put(`/studios/${t.studio.id}/guide`, { guide: "The host's private plan" }, ORIGIN);
    code = (await t.hostBrowser.put(`/studios/${t.studio.id}/solo`, { enabled: true, prompt: "Who are you?\nWhat changed this year?" }, ORIGIN)).body.code;
  });
  const join = (name = "Rana", headers: Record<string, string> = {}) =>
    t.fetchFor()("https://app.test/api/solo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers },
      body: JSON.stringify({ code, displayName: name, consent: true }),
    });
  const as = (token: string) => t.client({ token });

  it("is off until the host turns it on, keeps its link when the questions change, and dies when switched off", async () => {
    expect(code).toMatch(/^[\w-]{10,}$/);
    expect((await t.hostBrowser.put(`/studios/${t.studio.id}/solo`, { enabled: true, prompt: "New question" }, ORIGIN)).body).toEqual({ code, prompt: "New question" });
    expect((await t.services.studios.soloPreview(code))!.prompt).toBe("New question");
    expect((await t.hostBrowser.put(`/studios/${t.studio.id}/solo`, { enabled: false, prompt: "New question" }, ORIGIN)).body.code).toBeNull();
    expect(await t.services.studios.soloPreview(code)).toBeNull();
    expect((await join()).status).toBe(404);
    expect((await t.client().get(`/studios/${t.studio.id}/solo`)).status).toBe(401);
  });

  it("gives each person a session of their own where they start and stop the recording themselves", async () => {
    const res = await join();
    expect(res.status).toBe(201);
    const ticket = await res.json();
    expect(ticket).toMatchObject({ role: "guest", solo: { maxMinutes: 30 }, studio: { name: "My Podcast" } });
    expect(ticket.sessionId).not.toBe(t.sessionId); // not the studio's live session, which carries on
    const me = as(ticket.token);
    const started = (await me.post(`/sessions/${ticket.sessionId}/recordings`)).body;
    expect(started.session.status).toBe("solo");
    expect(started.recording.status).toBe("recording");
    expect((await t.call(`/sessions/${ticket.sessionId}/tracks`, { recordingId: started.recording.id, kind: "audio", mimeType: "audio/webm;codecs=opus", startedAt: t.now() }, ticket.token)).status).toBe(201);
    expect((await me.post(`/sessions/${ticket.sessionId}/recordings/${started.recording.id}/stop`)).body.recording.status).toBe("stopped");
    expect((await me.post(`/sessions/${ticket.sessionId}/end`)).body.session.status).toBe("ended");

    // It is one of the studio's recordings, numbered after the live one, by a consenting guest.
    const list = (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body.recordings;
    expect(list.map((r: { number: number }) => r.number)).toEqual([2, 1]);
    expect(await t.db.query("SELECT role, consented_at IS NOT NULL AS consented, consent_hash IS NOT NULL AS hashed FROM participants WHERE id = $1", [ticket.participantId])).toEqual([
      { role: "guest", consented: true, hashed: true },
    ]);
  });

  it("shows them what they were asked, never the host's own guide", async () => {
    const ticket = await (await join()).json();
    expect((await as(ticket.token).get(`/sessions/${ticket.sessionId}/guide`)).body).toEqual({ guide: "Who are you?\nWhat changed this year?" });
    expect(JSON.stringify(ticket)).not.toContain("private plan");
  });

  it("changes nothing for a guest of a live session: they still can't start or stop the recording", async () => {
    expect((await as(t.guest.token).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`)).status).toBe(403);
    expect((await as(t.guest.token).post(`/sessions/${t.sessionId}/end`)).status).toBe(403);
    // And a solo person has no say in anyone else's session.
    const ticket = await (await join()).json();
    expect((await as(ticket.token).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`)).status).toBe(403);
  });

  it("limits how many one address can start in an hour", async () => {
    for (let i = 0; i < SOLO_JOINS_PER_ADDRESS; i++) expect((await join(`P${i}`)).status).toBe(201);
    expect((await join("Late")).status).toBe(429);
    expect((await join("Other", { "x-forwarded-for": "198.51.100.3" })).status).toBe(201);
  });

  it("needs consent, like any guest", async () => {
    const res = await t.fetchFor()("https://app.test/api/solo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, displayName: "Rana", consent: false }) });
    expect(res.status).toBe(400);
  });
});
