import { consentTextFor, defaultConsentText, studioSettings } from "@tapry/shared";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expectOk, setup } from "./harness";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("consent per show", () => {
  it("uses the show's own text, or the default (sound-only wording for audio-only shows)", () => {
    const base = studioSettings.parse({});
    expect(consentTextFor(base, "Ines")).toBe(defaultConsentText("Ines", false));
    expect(consentTextFor({ ...base, audioOnly: true }, "Ines")).toMatch(/My microphone is recorded/);
    expect(consentTextFor({ ...base, consentText: "Our study's consent." }, "Ines")).toBe("Our study's consent.");
  });

  it("keeps, for each guest, when they agreed and the exact text (by its hash)", async () => {
    const t = await setup();
    const custom = "I agree to take part in the interview study.\nMy answers may be quoted without my name.";
    await expectOk(t.hostBrowser.patch(`/studios/${t.studio.id}`, { settings: { consentText: custom } }));
    const preview = (await t.services.studios.invitePreview(t.studio.inviteCode))!;
    expect(preview.consentText).toBe(custom);
    expect(preview.consentHash).toBe(sha256(custom));

    const joined = (await expectOk(
      t.client().post("/join", { inviteCode: t.studio.inviteCode, displayName: "Ana", consent: true, consentHash: preview.consentHash }),
    )).body;
    const [row] = await t.db.query<{ consent_hash: string; consented_at: Date; text: string }>(
      "SELECT p.consent_hash, p.consented_at, c.text FROM participants p JOIN consent_texts c ON c.hash = p.consent_hash WHERE p.id = $1",
      [joined.participantId],
    );
    expect(row).toMatchObject({ consent_hash: sha256(custom), text: custom });
    expect(row!.consented_at).toBeInstanceOf(Date);
  });

  it("turns a guest away who read an older text, so they read the new one", async () => {
    const t = await setup();
    const before = (await t.services.studios.invitePreview(t.studio.inviteCode))!;
    await expectOk(t.hostBrowser.patch(`/studios/${t.studio.id}`, { settings: { consentText: "Changed while they were reading." } }));
    const res = await t.client().post("/join", { inviteCode: t.studio.inviteCode, displayName: "Ana", consent: true, consentHash: before.consentHash });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("consent_changed");
  });

  it("writes an episode's consent record: everyone recorded, when, which text", async () => {
    const t = await setup();
    // The setup's guest joined with the default text; they record in the episode.
    await expectOk(
      t.call(`/sessions/${t.sessionId}/tracks`, { recordingId: t.recordingId, kind: "audio", mimeType: "audio/webm", startedAt: t.now() }),
    );
    await expectOk(
      t.call(`/sessions/${t.sessionId}/tracks`, { recordingId: t.recordingId, kind: "audio", mimeType: "audio/webm", startedAt: t.now() }, t.host.token),
    );
    const host = (await expectOk(t.hostBrowser.get("/auth/me"))).body.user;
    const { fileName, body } = await t.services.processing.consentRecord(host, t.studio.id, t.recordingId);
    expect(fileName).toBe("Consent record - Episode 1.txt");
    const hash = sha256(defaultConsentText("Host", false));
    expect(body).toMatch(/^Consent record: My Podcast, Episode 1\n/);
    expect(body).toContain("Host (host): runs the recording.");
    expect(body).toMatch(new RegExp(`Guest \\(guest\\): agreed \\d{4}-\\d\\d-\\d\\dT[\\d:]+Z, to text SHA-256 ${hash}`));
    expect(body).toContain(`Text SHA-256 ${hash}:\n${defaultConsentText("Host", false)}`);

    // Served as a text file, to the host only.
    const cookie = [...t.hostBrowser.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const url = `https://app.test/api/studios/${t.studio.id}/recordings/${t.recordingId}/consent`;
    const res = await t.fetchFor()(url, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(body);
    expect((await t.fetchFor()(url)).status).toBe(401);
  });
});
