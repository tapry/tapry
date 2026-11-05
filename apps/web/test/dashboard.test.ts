import { describe, expect, it } from "vitest";
import { expectOk, setup } from "./harness";

const MIME = "audio/webm;codecs=opus";

describe("dashboard data", () => {
  it("numbers recordings per studio, in order, and never reuses a deleted recording's number", async () => {
    const t = await setup();
    const host = t.client({ token: t.host.token });
    const record = async () => {
      const id: string = (await expectOk(host.post(`/sessions/${t.sessionId}/recordings`))).body.recording.id;
      await expectOk(host.post(`/sessions/${t.sessionId}/recordings/${id}/stop`));
      return id;
    };
    await expectOk(host.post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`)); // recording 1
    const second = await record();
    await expectOk(t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${second}`));
    await record();

    const { recordings } = (await expectOk(t.hostBrowser.get(`/studios/${t.studio.id}/recordings`))).body;
    expect(recordings.map((r: { number: number }) => r.number)).toEqual([3, 1]);

    // Another show starts at 1.
    const other = (await expectOk(t.hostBrowser.post("/studios", { name: "Other studio" }))).body;
    const otherHost = (await expectOk(t.hostBrowser.post(`/studios/${other.id}/open`))).body;
    await expectOk(t.client({ token: otherHost.token }).post(`/sessions/${otherHost.sessionId}/recordings`));
    const { recordings: otherList } = (await expectOk(t.hostBrowser.get(`/studios/${other.id}/recordings`))).body;
    expect(otherList.map((r: { number: number }) => r.number)).toEqual([1]);
  });

  it("lists who recorded in each recording, host first, with how far their upload got", async () => {
    const t = await setup();
    const register = async (token: string) =>
      (
        await expectOk(
          t.call(`/sessions/${t.sessionId}/tracks`, { recordingId: t.recordingId, kind: "audio", mimeType: MIME, startedAt: t.now() }, token),
        )
      ).body.trackId as string;
    await register(t.guest.token); // still uploading
    const hostTrack = await register(t.host.token);
    await expectOk(t.call(`/sessions/${t.sessionId}/tracks/${hostTrack}/complete`, { stoppedAt: t.now(), lastSeq: -1 }, t.host.token));

    const { recordings } = (await expectOk(t.hostBrowser.get(`/studios/${t.studio.id}/recordings`))).body;
    expect(recordings[0].people).toEqual([
      expect.objectContaining({ name: "Host", role: "host", tracks: 1, completeTracks: 1 }),
      expect.objectContaining({ name: "Guest", role: "guest", tracks: 1, completeTracks: 0 }),
    ]);
  });

  it("marks a studio live while it records", async () => {
    const t = await setup();
    const live = async () => (await expectOk(t.hostBrowser.get("/studios"))).body.studios[0].live;
    expect(await live()).toBe(true);
    await expectOk(t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
    expect(await live()).toBe(false);
  });

  it("shows guests the studio and who invited them, and nothing for a dead link", async () => {
    const t = await setup();
    expect(await t.services.studios.invitePreview(t.studio.inviteCode)).toMatchObject({ studioName: "My Podcast", hostName: "Host", settings: { audioOnly: false } });
    expect(await t.services.studios.invitePreview("not-a-real-code")).toBeNull();
    await expectOk(t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
    await expectOk(t.hostBrowser.del(`/studios/${t.studio.id}`));
    expect(await t.services.studios.invitePreview(t.studio.inviteCode)).toBeNull();
  });
});
