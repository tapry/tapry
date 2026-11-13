// AI notes: written from a finished transcript by a model on this server, or by an outside model
// only where the account's owner allowed it. Private by default: with neither, nothing is written
// and nothing is sent anywhere.
import { beforeEach, describe, expect, it } from "vitest";
import { JobRunner } from "../src/server/jobs";
import { AnthropicNotes, NOTES_INSTRUCTIONS, NOTES_MAX_CHARS, NotesError, OllamaNotes, type NotesInput, type NotesModel } from "../src/server/notes";
import { createServer, expectOk, FakeStorage, setup } from "./harness";

const ORIGIN = { origin: "https://app.test" };
const TRANSCRIPT = "[00:00:01] Host: Welcome back. Today we talk about recording at home.\n\n[00:00:09] Guest: Thanks. A quiet room matters more than the microphone.\n";
const NOTES = "# Notes: My Podcast, Recording 1\n\n## Summary\nThey talk about recording at home, and the guest says a quiet room matters more than the microphone.\n";

/** A model that records what it was asked and answers with fixed notes (or fails). */
class FakeModel implements NotesModel {
  calls: NotesInput[] = [];
  constructor(
    readonly where: "local" | "outside",
    readonly name: string,
    private answer: string | NotesError = NOTES,
  ) {}
  async generate(input: NotesInput) {
    this.calls.push(input);
    if (this.answer instanceof NotesError) throw this.answer;
    return this.answer;
  }
}

describe("AI notes: who may have them", () => {
  const PASSWORD = "correct horse battery";
  async function server(opts: { cloud: boolean; outside?: string | null; local?: string | null }) {
    const t = await createServer(undefined, { billing: { cloud: opts.cloud }, notes: { outside: opts.outside === undefined ? "claude-opus-5-5" : opts.outside, local: opts.local } });
    const owner = t.client();
    const user = (await expectOk(owner.post("/auth/signup", { email: "owner@example.com", name: "Olu Owner", password: PASSWORD }))).body.user;
    return { ...t, owner, user };
  }

  it("is off until the account's owner allows the outside model, and can be switched off again", async () => {
    const t = await server({ cloud: false });
    expect((await expectOk(t.owner.get("/ai-notes"))).body).toEqual({ mode: "off", localModel: null, outsideModel: "claude-opus-5-5", outsideOn: false, planAllows: true, canChange: true });
    expect((await expectOk(t.owner.put("/ai-notes", { outside: true }, ORIGIN))).body).toMatchObject({ mode: "outside", outsideOn: true });
    expect((await expectOk(t.owner.put("/ai-notes", { outside: false }, ORIGIN))).body).toMatchObject({ mode: "off", outsideOn: false });
  });

  it("needs a paid plan on Tapry Cloud, and stops when the plan goes", async () => {
    const t = await server({ cloud: true });
    const refused = await t.owner.put("/ai-notes", { outside: true }, ORIGIN);
    expect([refused.status, refused.body.error]).toEqual([402, "plan_no_ai_notes"]);
    await expectOk(t.owner.put(`/admin/accounts/${t.user.id}/plan`, { plan: "creator" }, ORIGIN));
    expect((await expectOk(t.owner.put("/ai-notes", { outside: true }, ORIGIN))).body.mode).toBe("outside");
    await expectOk(t.owner.put(`/admin/accounts/${t.user.id}/plan`, { plan: "free" }, ORIGIN));
    expect((await expectOk(t.owner.get("/ai-notes"))).body).toMatchObject({ mode: "off", outsideOn: true, planAllows: false });
  });

  it("can't be allowed where no outside model is set up, and a model on the server needs nobody's leave", async () => {
    const none = await server({ cloud: false, outside: null });
    expect((await none.owner.put("/ai-notes", { outside: true }, ORIGIN)).body.error).toBe("not_available");
    const local = await server({ cloud: true, outside: null, local: "llama3.1" });
    expect((await expectOk(local.owner.get("/ai-notes"))).body).toMatchObject({ mode: "local", localModel: "llama3.1", outsideOn: false });
  });

  it("is the owner's to decide, not a member's", async () => {
    const t = await server({ cloud: false });
    const { link } = (await expectOk(t.owner.post("/members/invites", { email: "mia@example.com" }, ORIGIN))).body;
    const member = t.client();
    await expectOk(member.post(`/invites/${/\/invite\/([\w-]+)$/.exec(link)![1]}`, { name: "Mia", password: PASSWORD }, ORIGIN));
    expect((await member.put("/ai-notes", { outside: true }, ORIGIN)).status).toBe(403);
    expect((await expectOk(member.get("/ai-notes"))).body.canChange).toBe(false);
  });
});

describe("AI notes: the job", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let storage: FakeStorage;
  beforeEach(async () => {
    storage = new FakeStorage();
    t = await setup(storage);
    await t.client({ token: t.host.token }).post(`/sessions/${t.sessionId}/recordings/${t.recordingId}/stop`);
  });

  /** The recording as it is once its transcript is ready, with the notes job the transcript job queues. */
  async function transcribed(text = TRANSCRIPT) {
    const key = `outputs/${t.sessionId}/${t.recordingId}/out_txt.txt`;
    storage.put(key, text, "text/plain");
    await t.db.query("DELETE FROM outputs WHERE recording_id = $1", [t.recordingId]);
    await t.db.query(
      `INSERT INTO outputs (id, recording_id, kind, file_name, content_type, storage_key, bytes) VALUES ('out_txt', $1, 'transcript', 'Transcript.txt', 'text/plain', $2, $3)`,
      [t.recordingId, key, Buffer.byteLength(text)],
    );
    await t.db.query("UPDATE recordings SET processing = 'ready', processed_at = now(), transcript = 'ready', transcribed_at = now() WHERE id = $1", [t.recordingId]);
    await t.db.query("DELETE FROM jobs WHERE recording_id = $1 AND type = 'notes_recording'", [t.recordingId]);
    await t.db.query("INSERT INTO jobs (id, type, recording_id) VALUES ('job_notes', 'notes_recording', $1)", [t.recordingId]);
    await t.db.query("UPDATE recordings SET notes = 'queued' WHERE id = $1", [t.recordingId]);
  }
  const run = (models: { local?: NotesModel; outside?: NotesModel }, opts: { cloud?: boolean; maxAttempts?: number } = {}) =>
    new JobRunner(t.db, storage, { ffmpeg: "ffmpeg", ffprobe: "ffprobe", ...opts, notesModels: { local: models.local ?? null, outside: models.outside ?? null } }).drain();
  const allowOutside = () => t.db.query("UPDATE users SET ai_outside_at = now()");
  const state = async () => (await t.db.query<{ notes: string; notes_error: string | null }>("SELECT notes, notes_error FROM recordings WHERE id = $1", [t.recordingId]))[0]!;
  const notesFiles = () => t.db.query<{ file_name: string; storage_key: string; content_type: string }>("SELECT file_name, storage_key, content_type FROM outputs WHERE recording_id = $1 AND kind = 'notes'", [t.recordingId]);

  it("sends nothing to an outside model unless the owner allowed it", async () => {
    await transcribed();
    const outside = new FakeModel("outside", "claude-opus-5-5");
    await run({ outside });
    expect(outside.calls).toEqual([]);
    expect(await notesFiles()).toEqual([]);
    expect(await state()).toEqual({ notes: "off", notes_error: null });
  });

  it("writes Notes.md from the transcript once the owner allowed the outside model, and says who wrote it", async () => {
    await transcribed();
    await allowOutside();
    const outside = new FakeModel("outside", "claude-opus-5-5");
    await run({ outside });
    expect(outside.calls).toEqual([{ title: "My Podcast, Recording 1", transcript: TRANSCRIPT }]);
    const [file] = await notesFiles();
    expect(file).toMatchObject({ file_name: "Notes.md", content_type: "text/markdown; charset=utf-8" });
    expect(file!.storage_key).toMatch(new RegExp(`^outputs/${t.sessionId}/${t.recordingId}/out_[\\w-]+\\.md$`)); // routed like every output
    const text = storage.objects.get(file!.storage_key)!.data.toString();
    expect(text.startsWith(NOTES)).toBe(true);
    expect(text).toContain("A draft written by an outside AI model (claude-opus-5-5)");
    expect(await state()).toEqual({ notes: "ready", notes_error: null });
    // Listed with the recording's files, and in what the host downloads.
    const listed = (await t.hostBrowser.get(`/studios/${t.studio.id}/recordings`)).body.recordings[0];
    expect(listed.outputs.map((o: { kind: string; fileName: string }) => [o.kind, o.fileName])).toContainEqual(["notes", "Notes.md"]);
  });

  it("uses the model on this server whenever there is one, with nobody's leave needed", async () => {
    await transcribed();
    const local = new FakeModel("local", "llama3.1");
    const outside = new FakeModel("outside", "claude-opus-5-5");
    await allowOutside();
    await run({ local, outside });
    expect([local.calls.length, outside.calls.length]).toEqual([1, 0]);
    expect(storage.objects.get((await notesFiles())[0]!.storage_key)!.data.toString()).toContain("an AI model on this server (llama3.1)");
  });

  it("on Tapry Cloud, writes none for an account whose plan doesn't include them", async () => {
    await transcribed();
    await allowOutside(); // allowed while on a paid plan, now on Free
    const outside = new FakeModel("outside", "claude-opus-5-5");
    await run({ outside }, { cloud: true });
    expect(outside.calls).toEqual([]);
    await t.db.query("UPDATE users SET plan = 'studio'");
    await transcribed();
    await run({ outside }, { cloud: true });
    expect(outside.calls.length).toBe(1);
  });

  it("says why when the model declines, and doesn't try again", async () => {
    await transcribed();
    await allowOutside();
    const outside = new FakeModel("outside", "claude-opus-5-5", new NotesError("refused", false));
    await run({ outside });
    expect(outside.calls.length).toBe(1);
    expect(await state()).toEqual({ notes: "failed", notes_error: "The AI model declined to write notes for this recording." });
    expect(await t.db.query("SELECT status, error FROM jobs WHERE id = 'job_notes'")).toEqual([{ status: "failed", error: "refused" }]);
  });

  it("tries again later when the model was busy", async () => {
    await transcribed();
    await allowOutside();
    await run({ outside: new FakeModel("outside", "claude-opus-5-5", new NotesError("busy", true, "status 429")) });
    expect((await state()).notes).toBe("queued");
    expect(await t.db.query("SELECT status, run_after > now() AS later FROM jobs WHERE id = 'job_notes'")).toEqual([{ status: "queued", later: true }]);
  });

  it("can be asked for again by the host, replacing the old notes", async () => {
    await transcribed();
    await allowOutside();
    await run({ outside: new FakeModel("outside", "claude-opus-5-5") });
    const [first] = await notesFiles();
    const server2 = await t.hostBrowser.post(`/studios/${t.studio.id}/recordings/${t.recordingId}/notes`, {}, ORIGIN);
    // This server's own settings have no model set up: asking is refused, nothing is queued.
    expect([server2.status, server2.body.error]).toEqual([409, "notes_off"]);
    await t.db.query("INSERT INTO jobs (id, type, recording_id) VALUES ('job_again', 'notes_recording', $1)", [t.recordingId]);
    await run({ outside: new FakeModel("outside", "claude-opus-5-5", NOTES.replace("quiet room", "calm room")) });
    const files = await notesFiles();
    expect(files.length).toBe(1);
    expect(files[0]!.storage_key).not.toBe(first!.storage_key);
    expect(storage.objects.has(first!.storage_key)).toBe(false); // the old file is gone from storage too
  });
});

describe("AI notes: the models", () => {
  const input = { title: "My Podcast, Recording 1", transcript: TRANSCRIPT };

  it("never sends a transcript that is empty or too long", async () => {
    const model = new OllamaNotes("http://ollama.test", "llama3.1", async () => {
      throw new Error("must not be called");
    });
    await expect(model.generate({ ...input, transcript: "  " })).rejects.toMatchObject({ code: "empty", retry: false });
    await expect(model.generate({ ...input, transcript: "x".repeat(NOTES_MAX_CHARS + 1) })).rejects.toMatchObject({ code: "too_long", retry: false });
  });

  it("asks the local model through Ollama's chat API and takes its answer", async () => {
    const seen: Array<{ url: string; body: any }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return Response.json({ message: { role: "assistant", content: NOTES } });
    }) as unknown as typeof fetch;
    expect(await new OllamaNotes("http://ollama.test/", "llama3.1", fetcher).generate(input)).toBe(NOTES);
    expect(seen[0]!.url).toBe("http://ollama.test/api/chat");
    expect(seen[0]!.body).toMatchObject({ model: "llama3.1", stream: false });
    expect(seen[0]!.body.messages[0]).toEqual({ role: "system", content: NOTES_INSTRUCTIONS });
    expect(seen[0]!.body.messages[1].content).toContain(`<transcript>\n${TRANSCRIPT}\n</transcript>`);
  });

  it("tells a model that isn't there from one that is busy, and rejects an answer that isn't notes", async () => {
    const answering = (res: () => Response) => new OllamaNotes("http://ollama.test", "llama3.1", (async () => res()) as unknown as typeof fetch);
    await expect(answering(() => new Response("no such model", { status: 404 })).generate(input)).rejects.toMatchObject({ code: "not_set_up", retry: false });
    await expect(answering(() => new Response("overloaded", { status: 503 })).generate(input)).rejects.toMatchObject({ code: "busy", retry: true });
    await expect(answering(() => Response.json({ message: { content: "I'm sorry, I can't help with that." } })).generate(input)).rejects.toMatchObject({ code: "failed" });
  });

  it("asks Claude with the fallback on, and reads refusals and cut-off answers as what they are", async () => {
    const requests: any[] = [];
    const client = (message: object) =>
      ({ beta: { messages: { stream: (params: object) => (requests.push(params), { finalMessage: async () => message }) } } }) as never;
    const ok = { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: NOTES }] };
    expect(await new AnthropicNotes("key", "claude-opus-5-5", client(ok)).generate(input)).toBe(NOTES);
    expect(requests[0]).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], system: NOTES_INSTRUCTIONS });
    expect(requests[0].messages).toEqual([{ role: "user", content: expect.stringContaining(TRANSCRIPT) }]);
    await expect(new AnthropicNotes("key", "claude-opus-5-5", client({ stop_reason: "refusal", content: [] })).generate(input)).rejects.toMatchObject({ code: "refused", retry: false });
    await expect(new AnthropicNotes("key", "claude-opus-5-5", client({ stop_reason: "max_tokens", content: [{ type: "text", text: NOTES }] })).generate(input)).rejects.toMatchObject({ code: "cut_off" });
  });
});
