import { describe, expect, it } from "vitest";
import { JobRunner } from "../src/server/jobs";
import type { MailMessage, Mailer } from "../src/server/mail";
import { createServer, expectOk, FakeStorage, setup } from "./harness";

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  fail: Error | null = null;
  async send(message: MailMessage) {
    if (this.fail) throw this.fail;
    this.sent.push(message);
  }
  async verify() {}
}

/** A cloud server with two stopped, processed recordings of one host; `keep` sets when each one's time is over. */
async function scene() {
  const storage = new FakeStorage();
  const mailer = new FakeMailer();
  const t = await setup(storage, { billing: { cloud: true } });
  const host = t.client({ token: t.host.token });
  await expectOk(host.post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`));
  t.tick(1000);
  const second = (await expectOk(host.post(`/sessions/${t.sessionId}/recordings`))).body.recording.id as string;
  await expectOk(host.post(`/sessions/${t.sessionId}/recordings/${second}/stop`));
  await t.db.query("DELETE FROM jobs");
  await t.db.query("UPDATE recordings SET processing = 'ready', processed_at = now() - interval '5 days'");
  const keep = (id: string, interval: string) => t.db.query(`UPDATE recordings SET keep_until = now() + interval '${interval}' WHERE id = $1`, [id]);
  // A fresh runner each time: each sweeps at once.
  const sweep = () => new JobRunner(t.db, storage, { ffmpeg: "ffmpeg", ffprobe: "ffprobe", cloud: true, mail: { mailer, appUrl: "https://studio.test/", promoUrl: null, cloud: true } }).drain();
  const state = async (id: string) =>
    (await t.db.query<{ gone: boolean; warned: boolean }>("SELECT deleted_at IS NOT NULL AS gone, expiry_warned_at IS NOT NULL AS warned FROM recordings WHERE id = $1", [id]))[0]!;
  return { ...t, storage, mailer, second, keep, sweep, state };
}

describe("a warning before a plan deletes a recording", () => {
  it("tells the host once, in one email, about every recording within three days of its time", async () => {
    const t = await scene();
    await t.keep(t.recordingId, "2 days");
    await t.keep(t.second, "60 hours");
    await t.sweep();

    expect(t.mailer.sent).toHaveLength(1);
    const mail = t.mailer.sent[0]!;
    expect(mail.to).toBe("host@example.com");
    expect(mail.subject).toBe("2 recordings will be deleted soon");
    expect(mail.text).toContain("Hello Host,");
    expect(mail.text).toContain("My Podcast, recording 1: deleted after");
    expect(mail.text).toContain(`https://studio.test/recordings/${t.recordingId}`);
    expect(mail.text).toContain(`https://studio.test/recordings/${t.second}`);
    expect(mail.html).toContain(`href="https://studio.test/recordings/${t.second}"`);
    expect(await t.state(t.recordingId)).toEqual({ gone: false, warned: true });

    await t.sweep();
    expect(t.mailer.sent).toHaveLength(1); // once
  });

  it("says nothing about a recording with more than three days left, or one kept for good", async () => {
    const t = await scene();
    await t.keep(t.recordingId, "4 days");
    await t.db.query("UPDATE recordings SET keep_until = NULL WHERE id = $1", [t.second]);
    await t.sweep();
    expect(t.mailer.sent).toEqual([]);
  });

  it("deletes only a day or more after the warning went, even when the time is already over", async () => {
    const t = await scene();
    await t.keep(t.recordingId, "-1 hour"); // over, and never warned (the server was down, say)
    await t.keep(t.second, "30 days");
    await t.sweep();
    expect(t.mailer.sent.map((m) => m.subject)).toEqual(["A recording will be deleted soon"]);
    expect(await t.state(t.recordingId)).toEqual({ gone: false, warned: true });

    await t.db.query("UPDATE recordings SET expiry_warned_at = now() - interval '23 hours' WHERE id = $1", [t.recordingId]);
    await t.sweep();
    expect((await t.state(t.recordingId)).gone).toBe(false);

    await t.db.query("UPDATE recordings SET expiry_warned_at = now() - interval '25 hours' WHERE id = $1", [t.recordingId]);
    await t.sweep();
    expect((await t.state(t.recordingId)).gone).toBe(true);
    expect((await t.state(t.second)).gone).toBe(false);
  });

  it("deletes nothing while the warning can't be sent, and logs no address", async () => {
    const t = await scene();
    await t.keep(t.recordingId, "-2 days");
    t.mailer.fail = Object.assign(new Error("550 host@example.com rejected"), { code: "EENVELOPE", responseCode: 550 });
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args.join(" "));
    try {
      await t.sweep();
    } finally {
      console.error = original;
    }
    expect(await t.state(t.recordingId)).toEqual({ gone: false, warned: false });
    expect(logged.join("\n")).toContain("EENVELOPE");
    expect(logged.join("\n")).not.toContain("host@example.com");
  });

  it("warns again after a bigger plan extended the time", async () => {
    const t = await scene();
    await t.keep(t.recordingId, "1 day");
    await t.keep(t.second, "30 days");
    await t.sweep();
    expect((await t.state(t.recordingId)).warned).toBe(true);
    const [{ id }] = (await t.db.query<{ id: string }>("SELECT id FROM users")) as [{ id: string }];
    await expectOk(t.hostBrowser.put(`/admin/accounts/${id}/plan`, { plan: "team" }, { origin: "https://app.test" }));
    expect(await t.state(t.recordingId)).toEqual({ gone: false, warned: false });
  });
});

describe("new accounts from one address", () => {
  it("are limited to a few an hour where sign-up is open; the first account isn't counted", async () => {
    const t = await createServer(new FakeStorage(), { allowSignup: true });
    const signup = (n: number) => t.client().post("/auth/signup", { email: `host${n}@example.com`, name: `Host ${n}`, password: "correct horse battery" });
    await expectOk(signup(0)); // the first account
    for (let n = 1; n <= 5; n++) await expectOk(signup(n));
    const refused = await signup(6);
    expect(refused.status).toBe(429);
    expect(refused.body.error).toBe("too_many_signups");
    // An attempt that fails counts too (an address taken), so guessing which exist is limited as well.
    t.tick(61 * 60_000);
    for (let n = 0; n < 5; n++) expect((await signup(1)).status).toBe(409);
    expect((await signup(7)).status).toBe(429);
    t.tick(61 * 60_000);
    await expectOk(signup(7));
  });
});
