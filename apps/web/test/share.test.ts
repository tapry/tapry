// Share pages: a recording's public page, reachable only by its link, off until turned on.
import { beforeEach, describe, expect, it } from "vitest";
import { FakeStorage, setup } from "./harness";

const ORIGIN = { origin: "https://app.test" };
const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Ines>Welcome back.\n\n00:00:03.500 --> 00:00:05.000\n<v Tom>Thanks for having me.\n";

describe("share pages", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let storage: FakeStorage;
  beforeEach(async () => {
    storage = new FakeStorage();
    t = await setup(storage);
    t.tick(60_000);
    await t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
    storage.put("outputs/x/c.mp4", "video bytes", "video/mp4");
    storage.put("outputs/x/t.vtt", VTT, "text/vtt");
    await t.db.query("UPDATE recordings SET processing = 'ready', transcript = 'ready' WHERE id = $1", [t.recordingId]);
    await t.db.query(
      `INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes, duration_ms)
       VALUES ('out_c', $1, 'combined', 'Combined.mp4', 'video/mp4', 'outputs/x/c.mp4', 11, 60000),
              ('out_t', $1, 'transcript', 'Transcript.vtt', 'text/vtt', 'outputs/x/t.vtt', $2, NULL)`,
      [t.recordingId, VTT.length],
    );
  });
  const path = () => `/studios/${t.studio.id}/recordings/${t.recordingId}/share`;
  const media = (code: string) => t.fetchFor()(`https://app.test/api/share/${code}/media`, { redirect: "manual" });

  it("is off until someone in the account turns it on, and shows the player only", async () => {
    expect((await t.hostBrowser.get(path())).body).toEqual({ code: null, transcript: false });
    const { code } = (await t.hostBrowser.put(path(), { enabled: true, transcript: false }, ORIGIN)).body;
    expect(code).toMatch(/^[\w-]{10,}$/);
    expect(await t.services.share.view(code)).toEqual({ title: "My Podcast, Recording 1", media: "video", lengthMs: 60_000, turns: null });
    const res = await media(code);
    expect([res.status, res.headers.get("location")]).toEqual([302, expect.stringContaining("outputs/x/c.mp4")]);
    expect((await t.client().get(path())).status).toBe(401);
  });

  it("shows the transcript only when the host shares that too", async () => {
    const { code } = (await t.hostBrowser.put(path(), { enabled: true, transcript: true }, ORIGIN)).body;
    expect((await t.services.share.view(code))!.turns).toEqual([
      { speaker: "Ines", startMs: 1000, text: "Welcome back." },
      { speaker: "Tom", startMs: 3500, text: "Thanks for having me." },
    ]);
    expect((await t.hostBrowser.put(path(), { enabled: true, transcript: false }, ORIGIN)).body.code).toBe(code); // same link
    expect((await t.services.share.view(code))!.turns).toBeNull();
  });

  it("dies when sharing stops, a new link is made or the recording is deleted", async () => {
    const first = (await t.hostBrowser.put(path(), { enabled: true, transcript: false }, ORIGIN)).body.code;
    const second = (await t.hostBrowser.put(path(), { enabled: true, transcript: false, newLink: true }, ORIGIN)).body.code;
    expect(second).not.toBe(first);
    expect(await t.services.share.view(first)).toBeNull();
    expect((await media(first)).status).toBe(404);
    expect(await t.services.share.view(second)).not.toBeNull();
    await t.hostBrowser.put(path(), { enabled: false, transcript: false }, ORIGIN);
    expect(await t.services.share.view(second)).toBeNull();
    const third = (await t.hostBrowser.put(path(), { enabled: true, transcript: false }, ORIGIN)).body.code;
    await t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`);
    expect(await t.services.share.view(third)).toBeNull();
    expect((await media(third)).status).toBe(404);
    expect((await media("no-such-code")).status).toBe(404);
  });
});
