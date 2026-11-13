// Screen tracks: what a person shared from their display, uploaded like the camera. Unlike a
// mask it is a real part of the recording: counted, waited for, and a file of its own.
import { chunkStorageKey } from "@tapry/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeStorage, setup, sha256 } from "./harness";

const AUDIO = "audio/webm;codecs=opus";
const VIDEO = "video/webm;codecs=vp9";
type Kind = "audio" | "screen";

describe("screen tracks", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let storage: FakeStorage;
  beforeEach(async () => {
    storage = new FakeStorage();
    t = await setup(storage);
  });

  const mime = (kind: Kind) => (kind === "audio" ? AUDIO : VIDEO);
  const createTrack = (kind: Kind, mimeType = mime(kind)) =>
    t.call(`/sessions/${t.sessionId}/tracks`, { recordingId: t.recordingId, kind, mimeType, startedAt: t.now() }, t.guest.token);
  async function upload(kind: Kind, bytes: number, complete = true) {
    const data = Buffer.alloc(bytes, 7);
    const { trackId } = (await createTrack(kind)).body;
    const meta = { bytes, sha256: sha256(data) };
    await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/upload-url`, { ...meta, mimeType: mime(kind) }, t.guest.token);
    storage.put(chunkStorageKey(t.sessionId, trackId, 0), data);
    await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/commit`, { ...meta, startTs: t.now(), endTs: t.now() + 2000 }, t.guest.token);
    if (complete) await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq: 0 }, t.guest.token);
    return trackId as string;
  }
  const stop = () => t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
  const summary = async () => (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body.recordings[0];

  it("is a track of its own kind, and must be a video", async () => {
    const res = await createTrack("screen");
    expect(res.status).toBe(201);
    expect(await t.db.query("SELECT kind FROM tracks WHERE id = $1", [res.body.trackId])).toEqual([{ kind: "screen" }]);
    expect(await createTrack("screen", AUDIO)).toMatchObject({ status: 400, body: { error: "invalid_screen" } });
  });

  it("counts as part of the person's recording: in the tracks, the upload figures and what processing waits for", async () => {
    await upload("audio", 10);
    const screen = await upload("screen", 1000, false);
    const live = (await t.client({ token: t.host.token }).get(`/sessions/${t.sessionId}/state`)).body;
    expect(live.uploads).toEqual([{ participantId: t.guest.participantId, tracks: 2, completeTracks: 1, bytes: 1010 }]);

    await stop();
    // The screen is still uploading: nothing is processed without it.
    expect(await summary()).toMatchObject({ tracks: 2, incompleteTracks: 1, processing: "pending" });
    await t.call(`/sessions/${t.sessionId}/tracks/${screen}/complete`, { stoppedAt: t.now(), lastSeq: 0 }, t.guest.token);
    expect(await summary()).toMatchObject({ incompleteTracks: 0, processing: "queued" });
  });

  it("can be shared more than once in a recording: each time is a track", async () => {
    await upload("screen", 100);
    await upload("screen", 100);
    expect((await summary()).tracks).toBe(2);
  });
});
