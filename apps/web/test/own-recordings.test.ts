import { describe, expect, it } from "vitest";
import { expectOk, setup } from "./harness";

/** A stopped recording where host and guest each recorded, processed: rows as the job runner leaves them. */
async function processedRecording() {
  const t = await setup();
  const track = async (token: string, trackId: string, kind: "audio" | "video") =>
    expectOk(
      t.call(
        `/sessions/${t.sessionId}/tracks`,
        { trackId, recordingId: t.recordingId, kind, mimeType: kind === "audio" ? "audio/webm" : "video/webm", startedAt: t.now() },
        token,
      ),
    );
  await track(t.guest.token, "trk_guest_audio_00000001", "audio");
  await track(t.guest.token, "trk_guest_video_00000001", "video");
  await track(t.host.token, "trk_host_audio_000000001", "audio");
  await expectOk(t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
  const output = (id: string, participantId: string | null, kind: string, fileName: string) =>
    t.db.query(
      `INSERT INTO outputs (id, recording_id, participant_id, kind, file_name, content_type, storage_key, bytes)
       VALUES ($1, $2, $3, $4, $5, 'application/octet-stream', $6, 1000)`,
      [id, t.recordingId, participantId, kind, fileName, `outputs/${id}`],
    );
  await output("out_g_a", t.guest.participantId, "audio", "Guest - audio.wav");
  await output("out_g_v", t.guest.participantId, "video", "Guest - video.mp4");
  await output("out_h_a", t.host.participantId, "audio", "Host - audio.wav");
  await output("out_c", null, "combined", "Combined.mp4");
  const ready = () => t.db.query("UPDATE recordings SET processing = 'ready' WHERE id = $1", [t.recordingId]);
  const mine = async (token: string) =>
    (await expectOk(t.client({ token }).get(`/sessions/${t.sessionId}/my-recordings`))).body;
  return { ...t, ready, mine };
}

describe("a participant's own recording (end screen)", () => {
  it("is announced while processing, then offered as links to their own files only", async () => {
    const t = await processedRecording();
    expect(await t.mine(t.guest.token)).toEqual({
      downloads: true,
      recordings: [{ number: 1, processing: expect.stringMatching(/pending|queued|processing/), files: [] }],
      promoUrl: null,
    });
    await t.ready();
    const { recordings } = await t.mine(t.guest.token);
    expect(recordings[0].files.map((f: { fileName: string }) => f.fileName)).toEqual(["Guest - audio.wav", "Guest - video.mp4"]);
    expect(recordings[0].files[0].url).toMatch(/^https:\/\/storage\.test\/outputs\/out_g_a\?/);
    // Never anyone else's, nor the combined video.
    const host = await t.mine(t.host.token);
    expect(host.recordings[0].files.map((f: { fileName: string }) => f.fileName)).toEqual(["Host - audio.wav"]);
  });

  it("offers nothing when the studio doesn't let guests download, and only to people in the session", async () => {
    const t = await processedRecording();
    await t.ready();
    await expectOk(t.hostBrowser.patch(`/studios/${t.studio.id}`, { settings: { guestDownloads: false } }));
    expect(await t.mine(t.guest.token)).toEqual({ downloads: false, recordings: [], promoUrl: null });
    expect((await t.client().get(`/sessions/${t.sessionId}/my-recordings`)).status).toBe(401);
  });

  it("leaves out a deleted recording", async () => {
    const t = await processedRecording();
    await t.ready();
    await expectOk(t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`));
    expect((await t.mine(t.guest.token)).recordings).toEqual([]);
  });
});
