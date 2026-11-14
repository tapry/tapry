// The dashboard's read-only views across a host's studios: recordings, studios, guests,
// transcripts, storage and the admin's settings. Each host sees only their own.
import { describe, expect, it } from "vitest";
import { maskKey, parseTxt, parseVtt, toTurns } from "../src/server/library";
import { createServer, expectOk, FakeStorage } from "./harness";

const MIME = "audio/webm;codecs=opus";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:02.500
<v Host>Welcome to the show.

00:00:03.000 --> 00:00:04.000
<v Host>Glad you &amp; me could talk.

00:00:09.000 --> 00:00:11.000
<v Sam Guest>Thanks. The lighthouse keeper's log is the villain here.
`;

/** Two hosts on one server: the admin with a studio, a guest and a stopped recording; and a second host. */
async function twoHosts() {
  const storage = new FakeStorage();
  const server = await createServer(storage, { allowSignup: true });
  const admin = server.client();
  await expectOk(admin.post("/auth/signup", { email: "admin@example.com", name: "Host", password: "correct horse battery" }));
  const other = server.client();
  await expectOk(other.post("/auth/signup", { email: "other@example.com", name: "Other", password: "correct horse battery" }));

  const studio = (await expectOk(admin.post("/studios", { name: "My Podcast" }))).body;
  const host = (await expectOk(admin.post(`/studios/${studio.id}/open`))).body;
  const guest = (await expectOk(server.client().post("/join", { inviteCode: studio.inviteCode, displayName: "Sam Guest", consent: true }))).body;
  const asHost = server.client({ token: host.token });
  const recordingId: string = (await expectOk(asHost.post(`/sessions/${host.sessionId}/recordings`))).body.recording.id;
  for (const token of [host.token, guest.token]) {
    await expectOk(
      server.client({ token }).post(`/sessions/${host.sessionId}/tracks`, { recordingId, kind: "audio", mimeType: MIME, startedAt: server.now() }),
    );
  }
  server.tick(60_000);
  await expectOk(asHost.post(`/sessions/${host.sessionId}/recordings/${recordingId}/stop`));

  const otherStudio = (await expectOk(other.post("/studios", { name: "Their Studio" }))).body;
  return { ...server, storage, admin, other, studio, otherStudio, host, guest, recordingId };
}

async function addTranscript(t: Awaited<ReturnType<typeof twoHosts>>) {
  const add = async (id: string, fileName: string, body: string) => {
    const key = `outputs/${t.host.sessionId}/${t.recordingId}/${id}`;
    t.storage.put(key, body);
    await t.db.query(
      `INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes) VALUES ($1, $2, 'transcript', $3, 'text/plain', $4, $5)`,
      [id, t.recordingId, fileName, key, Buffer.byteLength(body)],
    );
  };
  await add("out_vtt", "Transcript.vtt", VTT);
  await add("out_txt", "Transcript.txt", "[00:00:01] Host: Welcome to the show.\n");
  await add("out_srt", "Transcript.srt", "1\n00:00:01,000 --> 00:00:02,500\nHost: Welcome to the show.\n");
  await t.db.query("UPDATE recordings SET processing = 'ready', transcript = 'ready' WHERE id = $1", [t.recordingId]);
}

describe("recordings across studios", () => {
  it("lists the host's recordings from every studio with the studio's name, and nobody else's", async () => {
    const t = await twoHosts();
    const second = (await expectOk(t.admin.post("/studios", { name: "Second" }))).body;
    const h2 = (await expectOk(t.admin.post(`/studios/${second.id}/open`))).body;
    t.tick(1000);
    await expectOk(t.client({ token: h2.token }).post(`/sessions/${h2.sessionId}/recordings`));

    const { recordings } = (await expectOk(t.admin.get("/recordings"))).body;
    expect(recordings.map((r: { studioName: string; number: number; status: string }) => [r.studioName, r.number, r.status])).toEqual([
      ["Second", 1, "recording"],
      ["My Podcast", 1, "stopped"],
    ]);
    expect(recordings[1]).toMatchObject({ studioId: t.studio.id, people: [expect.objectContaining({ name: "Host" }), expect.objectContaining({ name: "Sam Guest" })] });

    const filtered = (await expectOk(t.admin.get(`/recordings?studio=${t.studio.id}&limit=5`))).body.recordings;
    expect(filtered.map((r: { id: string }) => r.id)).toEqual([t.recordingId]);

    expect((await expectOk(t.other.get("/recordings"))).body.recordings).toEqual([]);
    expect((await expectOk(t.other.get(`/recordings?studio=${t.studio.id}`))).body.recordings).toEqual([]);
  });

  it("opens one recording for its host only", async () => {
    const t = await twoHosts();
    expect((await expectOk(t.admin.get(`/recordings/${t.recordingId}`))).body).toMatchObject({ id: t.recordingId, studioName: "My Podcast" });
    expect((await t.other.get(`/recordings/${t.recordingId}`)).status).toBe(404);
    expect((await t.client().get(`/recordings/${t.recordingId}`)).status).toBe(401);
  });

  it("keeps the per-studio list exactly as it was (no studio fields added)", async () => {
    const t = await twoHosts();
    const [r] = (await expectOk(t.admin.get(`/studios/${t.studio.id}/recordings`))).body.recordings;
    expect(r).not.toHaveProperty("studioId");
    expect(r).not.toHaveProperty("studioName");
    expect(r).toMatchObject({ id: t.recordingId, number: 1 });
  });
});

describe("studio cards", () => {
  it("adds up hours and who recorded lately, per studio, for its host only", async () => {
    const t = await twoHosts();
    const { studios } = (await expectOk(t.admin.get("/dashboard/studios"))).body;
    expect(studios).toEqual([
      expect.objectContaining({ id: t.studio.id, name: "My Podcast", recordings: 1, recordedMs: 60_000, people: expect.arrayContaining(["Host", "Sam Guest"]) }),
    ]);
    expect(studios[0].lastRecordingAt).toEqual(expect.any(Number));
    const theirs = (await expectOk(t.other.get("/dashboard/studios"))).body.studios;
    expect(theirs).toEqual([expect.objectContaining({ name: "Their Studio", recordings: 0, recordedMs: 0, lastRecordingAt: null, people: [] })]);
  });
});

describe("guests", () => {
  it("lists guests who recorded, with their newest tech check under the same name", async () => {
    const t = await twoHosts();
    await expectOk(
      t.client().post(`/check/${t.studio.inviteCode}/report`, {
        reportId: "chk_aaaaaaaaaa",
        name: "sam guest",
        browser: "Chrome on macOS",
        checks: [
          { id: "camera", tone: "ok", label: "Camera works" },
          { id: "upload", tone: "warn", label: "Upload is slow" },
        ],
      }),
    );
    const { guests } = (await expectOk(t.admin.get("/guests"))).body;
    expect(guests).toEqual([
      {
        name: "Sam Guest",
        studios: [{ id: t.studio.id, name: "My Podcast" }],
        recordings: 1,
        lastJoinedAt: expect.any(Number),
        techCheck: { at: expect.any(Number), issues: [{ tone: "warn", label: "Upload is slow" }] },
      },
    ]);
    expect((await expectOk(t.other.get("/guests"))).body.guests).toEqual([]);
  });

  it("leaves out people who joined but never recorded", async () => {
    const t = await twoHosts();
    await expectOk(t.client().post("/join", { inviteCode: t.studio.inviteCode, displayName: "Just Looking", consent: true }));
    const names = (await expectOk(t.admin.get("/guests"))).body.guests.map((g: { name: string }) => g.name);
    expect(names).toEqual(["Sam Guest"]);
  });
});

describe("transcripts", () => {
  it("reads a recording's transcript into turns, for its host only", async () => {
    const t = await twoHosts();
    await addTranscript(t);
    const body = (await expectOk(t.admin.get(`/recordings/${t.recordingId}/transcript`))).body;
    expect(body).toEqual({
      state: "ready",
      turns: [
        { speaker: "Host", startMs: 1000, text: "Welcome to the show. Glad you & me could talk." },
        { speaker: "Sam Guest", startMs: 9000, text: "Thanks. The lighthouse keeper's log is the villain here." },
      ],
    });
    expect((await t.other.get(`/recordings/${t.recordingId}/transcript`)).status).toBe(404);
  });

  it("says nothing is there yet before the transcript is ready", async () => {
    const t = await twoHosts();
    expect((await expectOk(t.admin.get(`/recordings/${t.recordingId}/transcript`))).body).toEqual({ state: "off", turns: null });
  });

  it("lists transcripts with words and first line, and searches what was said", async () => {
    const t = await twoHosts();
    await addTranscript(t);
    const all = (await expectOk(t.admin.get("/transcripts"))).body;
    expect(all.model).toBeNull(); // no worker with a model in tests
    expect(all.transcripts).toEqual([
      expect.objectContaining({
        recordingId: t.recordingId,
        studioName: "My Podcast",
        state: "ready",
        words: 19,
        snippet: "Welcome to the show. Glad you & me could talk.",
        txt: "out_txt",
        srt: "out_srt",
      }),
    ]);
    const hit = (await expectOk(t.admin.get(`/transcripts?q=${encodeURIComponent("LIGHTHOUSE")}`))).body.transcripts;
    expect(hit).toHaveLength(1);
    expect(hit[0].snippet).toContain("lighthouse keeper");
    expect((await expectOk(t.admin.get("/transcripts?q=submarine"))).body.transcripts).toEqual([]);
    // Another host can't find words from this recording.
    expect((await expectOk(t.other.get("/transcripts?q=lighthouse"))).body.transcripts).toEqual([]);
  });

  it("reads each transcript file from storage once, then from memory", async () => {
    const t = await twoHosts();
    await addTranscript(t);
    await expectOk(t.admin.get("/transcripts"));
    await expectOk(t.admin.get("/transcripts?q=show"));
    await expectOk(t.admin.get(`/recordings/${t.recordingId}/transcript`));
    expect(t.storage.reads.filter((k) => k.endsWith("out_vtt"))).toHaveLength(1);
  });

  it("parses the worker's files", () => {
    expect(parseVtt(VTT).map((c) => c.speaker)).toEqual(["Host", "Host", "Sam Guest"]);
    expect(parseTxt("[00:01:02] Ana: Hello there.\n\n[01:00:00] Bo: Hi: again.\n")).toEqual([
      { speaker: "Ana", startMs: 62_000, endMs: 62_000, text: "Hello there." },
      { speaker: "Bo", startMs: 3_600_000, endMs: 3_600_000, text: "Hi: again." },
    ]);
    // A pause of 3 s or more starts a new turn.
    expect(toTurns(parseVtt(VTT)).map((x) => x.speaker)).toEqual(["Host", "Sam Guest"]);
  });
});

describe("storage and settings", () => {
  it("counts the host's space, recordings and confirmed pieces; config and the live check for admins only", async () => {
    const t = await twoHosts();
    const mine = (await expectOk(t.admin.get("/storage"))).body;
    expect(mine).toMatchObject({
      bytes: 0,
      studios: [{ id: t.studio.id, name: "My Podcast", bytes: 0 }],
      recordings: 1,
      originalsRemoved: 0,
      pieces: { confirmed: 0, missing: 0 },
      admin: { status: { ok: true }, uploadGraceDays: 7, rawRetentionDays: null },
    });
    const theirs = (await expectOk(t.other.get("/storage"))).body;
    expect(theirs).toMatchObject({ recordings: 0, studios: [{ name: "Their Studio" }], admin: null });
  });

  it("shows the workspace settings to the admin only", async () => {
    const t = await twoHosts();
    expect((await expectOk(t.admin.get("/admin/settings"))).body).toMatchObject({ emailOn: false, transcriptsModel: null, setupTokenSet: false });
    expect((await t.other.get("/admin/settings")).status).toBe(404);
  });

  it("says when the workers can't find the transcript model, so the page doesn't promise transcripts", async () => {
    const t = await twoHosts();
    const beat = (modelFound: boolean) =>
      t.db.query(`INSERT INTO workers (id, kind, version, info, seen_at) VALUES ('wrk_t', 'worker', '0', $1, now()) ON CONFLICT (id) DO UPDATE SET info = EXCLUDED.info`, [
        JSON.stringify({ ffmpeg: "ffmpeg 7", ffprobe: "ffprobe 7", whisper: { model: "/models/ggml-base.bin", modelFound }, tmpFreeBytes: 1 }),
      ]);
    await beat(false);
    expect(await t.services.library.transcriptsModel()).toEqual({ name: "ggml-base.bin", found: false });
    await beat(true);
    expect(await t.services.library.transcriptsModel()).toEqual({ name: "ggml-base.bin", found: true });
  });

  it("masks access keys", () => {
    expect(maskKey("AKIAIOSFODNN7EXAMPLE")).toBe("AKIA…MPLE");
    expect(maskKey("tapry")).toBe("ta…");
  });

  it("counts what an account recorded, month by month, and nobody else's", async () => {
    const t = await twoHosts();
    const usage = (await expectOk(t.admin.get("/usage"))).body;
    expect(usage).toMatchObject({ recordings: 1, recordedMs: 60_000, guests: 1, transcripts: 0 });
    expect(usage.months).toHaveLength(12);
    const thisMonth = new Date(t.now()).toISOString().slice(0, 7);
    expect(usage.months.at(-1)).toEqual({ month: thisMonth, recordings: 1, recordedMs: 60_000, guests: 1 });
    expect(usage.months.slice(0, 11).every((m: { recordings: number }) => m.recordings === 0)).toBe(true);

    expect((await expectOk(t.other.get("/usage"))).body).toMatchObject({ recordings: 0, recordedMs: 0, guests: 0 });

    // A deleted recording leaves the count.
    await expectOk(t.admin.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`));
    expect((await expectOk(t.admin.get("/usage"))).body).toMatchObject({ recordings: 0, guests: 0 });
  });
});
