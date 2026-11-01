import { chunkStorageKey } from "@opentake/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { JobRunner } from "../src/server/jobs";
import { expectOk, FakeStorage, setup, sha256 } from "./harness";

const MIME = "audio/webm;codecs=opus";

// RAW_RETENTION_DAYS: the original uploads of a processed episode are removed after a while,
// the processed files stay. Off by default; these tests drive the purge_raw job directly.
describe("raw upload retention", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let storage: FakeStorage;

  beforeEach(async () => {
    storage = new FakeStorage();
    t = await setup(storage);
  });

  const runner = () => new JobRunner(t.db, storage, { ffmpeg: "ffmpeg", ffprobe: "ffprobe", rawRetentionMs: 0 });
  const rec = async () =>
    (await t.db.query<{ processing: string; raw_deleted_at: Date | null }>("SELECT processing, raw_deleted_at FROM recordings WHERE id = $1", [t.recordingId]))[0]!;
  const keysUnder = (prefix: string) => [...storage.objects.keys()].filter((k) => k.startsWith(prefix));

  async function uploadTrack(parts: string[], complete = true) {
    const { trackId } = (
      await expectOk(t.call(`/sessions/${t.sessionId}/tracks`, { recordingId: t.recordingId, kind: "audio", mimeType: MIME, startedAt: t.now() }))
    ).body;
    for (const [seq, text] of parts.entries()) {
      const meta = { bytes: Buffer.byteLength(text), sha256: sha256(text) };
      await expectOk(t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/upload-url`, { ...meta, mimeType: MIME }));
      storage.put(chunkStorageKey(t.sessionId, trackId, seq), text);
      await expectOk(t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/${seq}/commit`, { ...meta, startTs: t.now(), endTs: t.now() + 1 }));
    }
    if (complete) await expectOk(t.call(`/sessions/${t.sessionId}/tracks/${trackId}/complete`, { stoppedAt: t.now(), lastSeq: parts.length - 1 }));
    return trackId as string;
  }

  /** The state a successful processing run leaves: a processed file, and the purge_raw job due. */
  async function processed() {
    await expectOk(t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
    await t.db.query("DELETE FROM jobs WHERE recording_id = $1", [t.recordingId]); // skip real processing
    const key = `outputs/${t.sessionId}/${t.recordingId}/out_a.wav`;
    storage.put(key, "processed audio");
    await t.db.query(
      `INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes) VALUES ('out_a', $1, 'audio', 'Guest - audio.wav', 'audio/wav', $2, 15)`,
      [t.recordingId, key],
    );
    await t.db.query("UPDATE recordings SET processing = 'ready' WHERE id = $1", [t.recordingId]);
    await t.db.query("INSERT INTO jobs (id, type, recording_id) VALUES ('job_raw', 'purge_raw', $1)", [t.recordingId]);
    return key;
  }

  it("removes the original uploads and keeps the processed files", async () => {
    const trackId = await uploadTrack(["abc", "defg"]);
    const output = await processed();
    await runner().drain();

    expect(keysUnder(`recordings/${t.sessionId}/${trackId}/`)).toEqual([]);
    expect(storage.objects.has(output)).toBe(true);
    expect((await rec()).raw_deleted_at).not.toBeNull();
    const [episode] = (await expectOk(t.hostBrowser.get(`/studios/${t.studio.id}/recordings`))).body.recordings;
    expect(episode).toMatchObject({ rawDeleted: true, bytes: 15, processing: "ready" });
  });

  it("then refuses to process again, and turns away a late upload (410) instead of half-using it", async () => {
    const trackId = await uploadTrack(["abc"]);
    await processed();
    await runner().drain();

    const again = await t.hostBrowser.post(`/studios/${t.studio.id}/recordings/${t.recordingId}/process`);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("originals_removed");
    const late = await t.call(`/sessions/${t.sessionId}/tracks`, { recordingId: t.recordingId, kind: "video", mimeType: MIME, startedAt: t.now() });
    expect(late.status).toBe(410);
    const commit = await t.call(`/sessions/${t.sessionId}/tracks/${trackId}/chunks/0/commit`, { bytes: 3, sha256: sha256("abc"), startTs: 0, endTs: 1 });
    expect(commit.status).toBe(410);
  });

  it("keeps everything while a guest's track is still arriving", async () => {
    const trackId = await uploadTrack(["abc"], false);
    await processed();
    await runner().drain();

    expect(keysUnder(`recordings/${t.sessionId}/${trackId}/`)).toHaveLength(1);
    expect((await rec()).raw_deleted_at).toBeNull();
  });

  it("waits while the episode is being processed again", async () => {
    const trackId = await uploadTrack(["abc"]);
    await processed();
    await t.db.query("UPDATE recordings SET processing = 'queued' WHERE id = $1", [t.recordingId]);
    await runner().drain();

    expect(keysUnder(`recordings/${t.sessionId}/${trackId}/`)).toHaveLength(1);
    const [job] = await t.db.query<{ status: string }>("SELECT status FROM jobs WHERE id = 'job_raw'");
    expect(job!.status).toBe("queued"); // comes back later
  });
});
