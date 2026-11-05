import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config";
import { JobRunner } from "../src/server/jobs";
import { mailFailureReason, SmtpMailer, type MailMessage, type Mailer } from "../src/server/mail";
import { MAX_RECAP_SENDS, recapMessage, sendDueRecaps, sweepRecaps } from "../src/server/recap";
import { createServer, expectOk, FakeStorage, setup } from "./harness";
import { startSmtpSink } from "./smtp-sink";

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  fail: Error | null = null;
  async send(message: MailMessage) {
    if (this.fail) throw this.fail;
    this.sent.push(message);
  }
  async verify() {
    if (this.fail) throw this.fail;
  }
}

const GUEST_EMAIL = "sam@guest.test";

/** A stopped recording the guest recorded in; `ready()` finishes its processing. */
async function recording() {
  const mailer = new FakeMailer();
  const t = await setup(new FakeStorage(), { mailer });
  await expectOk(
    t.call(
      `/sessions/${t.sessionId}/tracks`,
      { trackId: "trk_guest_audio_00000001", recordingId: t.recordingId, kind: "audio", mimeType: "audio/webm", startedAt: t.now() },
      t.guest.token,
    ),
  );
  await expectOk(t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
  const guestApi = t.client({ token: t.guest.token });
  const ready = async () => {
    await t.db.query(
      `INSERT INTO outputs (id, recording_id, participant_id, kind, file_name, content_type, storage_key, bytes)
       VALUES ('out_g', $1, $2, 'audio', 'Guest - audio.wav', 'audio/wav', 'outputs/out_g', 1000) ON CONFLICT DO NOTHING`,
      [t.recordingId, t.guest.participantId],
    );
    await t.db.query("UPDATE recordings SET processing = 'ready' WHERE id = $1", [t.recordingId]);
  };
  const ask = (email = GUEST_EMAIL) => guestApi.post(`/sessions/${t.sessionId}/recap`, { email });
  const status = async () => (await expectOk(guestApi.get(`/sessions/${t.sessionId}/recap`))).body;
  const send = () => sendDueRecaps(t.db, { mailer, appUrl: "https://studio.test/", promoUrl: null });
  const row = async () => (await t.db.query<{ email: string | null; status: string; attempts: number; error: string | null; run_after: Date }>("SELECT * FROM recap_requests"))[0];
  const tokenIn = (m: MailMessage) => /\/recap\/([\w-]+)/.exec(m.text)![1]!;
  return { ...t, mailer, ready, ask, status, send, row, tokenIn };
}

describe("the guest's recap email", () => {
  it("is only offered when the server sends email", async () => {
    const t = await setup();
    const guest = t.client({ token: t.guest.token });
    expect((await expectOk(guest.get(`/sessions/${t.sessionId}/recap`))).body).toMatchObject({ enabled: false, status: "none" });
    expect((await guest.post(`/sessions/${t.sessionId}/recap`, { email: GUEST_EMAIL })).status).toBe(409);
    expect((await t.client().post(`/sessions/${t.sessionId}/recap`, { email: GUEST_EMAIL })).status).toBe(401);
  });

  it("waits for the files, sends a link, then keeps no address", async () => {
    const t = await recording();
    expect(await t.status()).toEqual({ enabled: true, status: "none", email: null, canSend: true });
    expect((await t.ask("not an address")).status).toBe(400);
    await expectOk(t.ask());
    expect(await t.status()).toMatchObject({ status: "pending", email: GUEST_EMAIL });

    await t.send();
    expect(t.mailer.sent).toEqual([]); // still processing

    await t.ready();
    await t.send();
    expect(t.mailer.sent).toHaveLength(1);
    const [mail] = t.mailer.sent;
    expect(mail!.to).toBe(GUEST_EMAIL);
    expect(mail!.text).toMatch(/https:\/\/studio\.test\/recap\/[\w-]{20,}/);
    expect(await t.status()).toMatchObject({ status: "sent", email: null });
    expect((await t.row())!.email).toBeNull();

    await t.send();
    expect(t.mailer.sent).toHaveLength(1); // once

    // The link opens this person's files, and the token isn't what's stored.
    const token = t.tokenIn(mail!);
    expect(await t.services.recaps.participantFor(token)).toMatchObject({ id: t.guest.participantId, sessionId: t.sessionId });
    expect(JSON.stringify(await t.row())).not.toContain(token);
    expect(await t.services.recaps.participantFor("wrong")).toBeNull();
  });

  it("waits for every recording the guest is in", async () => {
    const t = await recording();
    await t.ready();
    await expectOk(t.ask());
    await t.db.query("UPDATE recordings SET processing = 'processing' WHERE id = $1", [t.recordingId]);
    await t.send();
    expect(t.mailer.sent).toEqual([]);
    await t.db.query("UPDATE recordings SET processing = 'ready' WHERE id = $1", [t.recordingId]);
    await t.send();
    expect(t.mailer.sent).toHaveLength(1);
  });

  it("is sent by the job runner, when the runner has mail", async () => {
    const t = await recording();
    await t.ready();
    await expectOk(t.ask());
    const opts = { ffmpeg: "ffmpeg", ffprobe: "ffprobe" };
    await new JobRunner(t.db, new FakeStorage(), opts).drain();
    expect(t.mailer.sent).toEqual([]);
    await new JobRunner(t.db, new FakeStorage(), { ...opts, mail: { mailer: t.mailer, appUrl: "https://studio.test", promoUrl: null } }).drain();
    expect(t.mailer.sent).toHaveLength(1);
  });

  it("can change address; a new send kills the old link; sends are capped", async () => {
    const t = await recording();
    await t.ready();
    await expectOk(t.ask("typo@guest.test"));
    await expectOk(t.ask()); // before sending: replaced, not a second mail
    await t.send();
    expect(t.mailer.sent.map((m) => m.to)).toEqual([GUEST_EMAIL]);
    const first = t.tokenIn(t.mailer.sent[0]!);

    for (let i = 1; i < MAX_RECAP_SENDS; i++) {
      await expectOk(t.ask(`again${i}@guest.test`));
      expect(await t.services.recaps.participantFor(first)).toBeNull();
      await t.send();
    }
    expect(t.mailer.sent).toHaveLength(MAX_RECAP_SENDS);
    expect(await t.status()).toMatchObject({ canSend: false });
    expect((await t.ask("one-more@guest.test")).status).toBe(429);
  });

  it("retries, then gives up and forgets the address; failures never store it", async () => {
    const t = await recording();
    await t.ready();
    await expectOk(t.ask());
    t.mailer.fail = Object.assign(new Error(`550 <${GUEST_EMAIL}> no such user`), { code: "EENVELOPE", responseCode: 550 });
    await t.send();
    let row = await t.row();
    expect(row).toMatchObject({ status: "pending", attempts: 1, error: "EENVELOPE (server said 550)", email: GUEST_EMAIL });
    expect(row!.run_after.getTime()).toBeGreaterThan(Date.now());

    for (let i = 0; i < 4; i++) {
      await t.db.query("UPDATE recap_requests SET run_after = now()");
      await t.send();
    }
    row = await t.row();
    expect(row).toMatchObject({ status: "failed", email: null, error: "EENVELOPE (server said 550)" });
    expect(await t.status()).toMatchObject({ status: "failed", canSend: true });
    expect(JSON.stringify(await t.services.health.report())).not.toContain(GUEST_EMAIL);
    // Tries again later, as a guest's fresh request.
    t.mailer.fail = null;
    await expectOk(t.ask());
    await t.send();
    expect(t.mailer.sent).toHaveLength(1);
  });

  it("gives up when the guest has no files, or the host turned downloads off", async () => {
    const t = await recording();
    await expectOk(t.ask());
    await t.db.query("UPDATE recordings SET processing = 'failed' WHERE id = $1", [t.recordingId]);
    await t.send();
    expect(t.mailer.sent).toEqual([]);
    expect(await t.row()).toMatchObject({ status: "failed", email: null, error: "NO_FILES" });

    const u = await recording();
    await u.ready();
    await expectOk(u.ask());
    await expectOk(u.hostBrowser.patch(`/studios/${u.studio.id}`, { settings: { guestDownloads: false } }));
    await u.send();
    expect(u.mailer.sent).toEqual([]);
    expect(await u.row()).toMatchObject({ status: "failed", email: null });
    expect(await u.status()).toMatchObject({ enabled: false });
    expect((await u.ask()).status).toBe(409);
  });

  it("forgets the address when the host deletes the recording", async () => {
    const t = await recording();
    await expectOk(t.ask());
    await t.db.query("UPDATE recordings SET processing = 'ready' WHERE id = $1", [t.recordingId]);
    expect((await t.hostBrowser.del(`/studios/${t.studio.id}/recordings/${t.recordingId}`)).status).toBeLessThan(300);
    expect(await t.row()).toBeUndefined();
    await t.send();
    expect(t.mailer.sent).toEqual([]);
  });

  it("stops the link once the studio is deleted, or after it expires", async () => {
    const t = await recording();
    await t.ready();
    await expectOk(t.ask());
    await t.send();
    const token = t.tokenIn(t.mailer.sent[0]!);
    await t.db.query("UPDATE studios SET deleted_at = now()");
    expect(await t.services.recaps.participantFor(token)).toBeNull();
    await t.db.query("UPDATE studios SET deleted_at = NULL");
    expect(await t.services.recaps.participantFor(token)).not.toBeNull();
    await t.db.query("UPDATE recap_requests SET expires_at = now() - interval '1 minute'");
    expect(await t.services.recaps.participantFor(token)).toBeNull();
    await sweepRecaps(t.db);
    expect(await t.row()).toBeUndefined();
  });

  it("drops an old request that never got its files", async () => {
    const t = await recording();
    await expectOk(t.ask());
    await sweepRecaps(t.db);
    expect(await t.row()).toBeDefined();
    await t.db.query("UPDATE recap_requests SET created_at = now() - interval '31 days'");
    await sweepRecaps(t.db);
    expect(await t.row()).toBeUndefined();
  });

  it("escapes the studio's name, and only carries the promo link when set", () => {
    const m = recapMessage("a@b.test", `<script>"x"</script>`, "https://s.test/recap/t", null);
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.text).not.toContain("Record your own");
    expect(recapMessage("a@b.test", "Show", "https://s.test/recap/t", "https://tapry.test/").text).toContain("https://tapry.test/");
  });
});

describe("SMTP", () => {
  let close: () => Promise<void> = async () => {};
  afterEach(() => close());

  it("delivers through a real SMTP conversation; a refusal's reason leaves the address out", async () => {
    const sink = await startSmtpSink();
    close = sink.close;
    const mailer = new SmtpMailer({ host: "127.0.0.1", port: sink.port, from: "Studio <studio@tapry.test>", insecure: true });
    await mailer.verify();
    await mailer.send(recapMessage(GUEST_EMAIL, "My studio", "https://studio.test/recap/abc", null));
    expect(sink.mails).toHaveLength(1);
    expect(sink.mails[0]!.to).toBe(GUEST_EMAIL);
    expect(sink.mails[0]!.decoded).toContain("Subject: Your recording from My studio");
    expect(sink.mails[0]!.decoded).toContain("https://studio.test/recap/abc");

    sink.rejectWith = "550";
    const err = await mailer.send(recapMessage(GUEST_EMAIL, "My studio", "https://studio.test/recap/abc", null)).catch((e) => e);
    expect(String(err)).toContain(GUEST_EMAIL); // the library's own message does quote it…
    expect(mailFailureReason(err)).toMatch(/^[A-Z_]+ \(server said 550\)$/); // …ours doesn't
  });

  it("refuses an unencrypted connection unless told otherwise", async () => {
    const sink = await startSmtpSink();
    close = sink.close;
    const mailer = new SmtpMailer({ host: "127.0.0.1", port: sink.port, from: "s@tapry.test", insecure: false });
    await expect(mailer.send(recapMessage(GUEST_EMAIL, "S", "https://s.test/recap/t", null))).rejects.toThrow();
    expect(sink.mails).toEqual([]);
  });
});

describe("email settings and health", () => {
  const base = { S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" };

  it("is off unless SMTP_HOST is set, and needs a sender and an address then", () => {
    expect(loadConfig({ ...base, SMTP_HOST: "" }).mail).toBeNull();
    expect(() => loadConfig({ ...base, SMTP_HOST: "smtp.test" })).toThrow(/SMTP_FROM/);
    const on = loadConfig({ ...base, SMTP_HOST: "smtp.test", SMTP_PORT: "", SMTP_FROM: "a@b.test", APP_URL: "https://s.test" });
    expect(on.mail).toMatchObject({ appUrl: "https://s.test", smtp: { host: "smtp.test", port: 587, insecure: false } });
  });

  it("shows on the health page", async () => {
    const check = async (s: Awaited<ReturnType<typeof createServer>>) => (await s.services.health.report()).checks.find((c) => c.id === "email")!;
    expect(await check(await createServer())).toMatchObject({ tone: "off" });
    const mailer = new FakeMailer();
    const s = await createServer(new FakeStorage(), { mailer });
    expect(await check(s)).toMatchObject({ tone: "ok", summary: "On" });
    mailer.fail = Object.assign(new Error("nope"), { code: "ECONNECTION" });
    expect(await check(s)).toMatchObject({ tone: "danger", details: [expect.stringContaining("ECONNECTION"), expect.any(String)] });
  });
});
