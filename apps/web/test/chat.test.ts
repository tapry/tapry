// Text messages in a session: between the people in it, in the server's memory only.
import { CHAT_MAX_CHARS } from "@tapry/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { mergeMessages, unreadCount } from "../src/lib/client/chat";
import { CHAT_KEEP, CHAT_PER_MINUTE } from "../src/server/live";
import { setup } from "./harness";

describe("session chat", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });
  const as = (token: string) => t.client({ token });
  const path = () => `/sessions/${t.sessionId}/chat`;
  const state = async () => (await as(t.host.token).get(`/sessions/${t.sessionId}/state`)).body;

  it("reaches everyone in the session, numbered in order, and the state says a new one is there", async () => {
    expect((await state()).chatSeq).toBe(0);
    const first = await as(t.guest.token).post(path(), { text: "  Can you hear me?  " });
    expect(first).toMatchObject({ status: 201, body: { seq: 1, text: "Can you hear me?" } });
    await as(t.host.token).post(path(), { text: "Yes.\nGo ahead" });
    expect((await state()).chatSeq).toBe(2);
    const all = (await as(t.host.token).get(path())).body.messages;
    expect(all.map((m: { seq: number; text: string }) => [m.seq, m.text])).toEqual([[1, "Can you hear me?"], [2, "Yes.\nGo ahead"]]);
    expect(all[0].participantId).not.toBe(all[1].participantId);
    // A device that already has the first asks for what came after.
    expect((await as(t.guest.token).get(`${path()}?after=1`)).body.messages).toHaveLength(1);
  });

  it("is only for people in the session", async () => {
    expect((await t.client({}).post(path(), { text: "hi" })).status).toBe(401);
    expect((await t.client({}).get(path())).status).toBe(401);
    const other = await setup();
    expect((await other.client({ token: other.guest.token }).get(path())).status).toBe(403);
  });

  it("refuses empty, overlong and control-character text", async () => {
    for (const text of ["", "   ", "x".repeat(CHAT_MAX_CHARS + 1), "bell\u0007", "hidden‮"]) {
      expect((await as(t.guest.token).post(path(), { text })).status, JSON.stringify(text)).toBe(400);
    }
    expect((await as(t.guest.token).post(path(), { text: "x".repeat(CHAT_MAX_CHARS) })).status).toBe(201);
    expect((await as(t.guest.token).post(path(), { text: "مرحبا 👋 ¿qué tal?" })).status).toBe(201);
  });

  it("limits how fast one person writes, without stopping the others", async () => {
    for (let i = 0; i < CHAT_PER_MINUTE; i++) expect((await as(t.guest.token).post(path(), { text: `${i}` })).status).toBe(201);
    expect(await as(t.guest.token).post(path(), { text: "more" })).toMatchObject({ status: 429, body: { error: "too_many_messages" } });
    expect((await as(t.host.token).post(path(), { text: "still here" })).status).toBe(201);
  });

  it("keeps only the newest, and nothing once the session has ended", async () => {
    // More than is kept, a minute apart per batch so the per-person limit isn't what stops them.
    for (let i = 1; i <= CHAT_KEEP + 5; i++) {
      if (i % CHAT_PER_MINUTE === 0) t.tick(61_000);
      expect((await as(t.guest.token).post(path(), { text: `${i}` })).status).toBe(201);
    }
    const kept = (await as(t.host.token).get(path())).body.messages;
    expect(kept).toHaveLength(CHAT_KEEP);
    expect([kept[0].seq, kept.at(-1).seq]).toEqual([6, CHAT_KEEP + 5]);

    await as(t.host.token).post(`/sessions/${t.sessionId}/end`);
    expect((await as(t.guest.token).get(path())).body.messages).toEqual([]);
    expect(await as(t.guest.token).post(path(), { text: "anyone?" })).toMatchObject({ status: 409, body: { error: "session_ended" } });
  });
});

describe("a device's copy of the chat", () => {
  const m = (seq: number, participantId: string) => ({ seq, participantId, text: `${seq}`, at: seq });

  it("has each message once, in order", () => {
    const have = [m(1, "a"), m(2, "b")];
    expect(mergeMessages(have, [])).toBe(have);
    expect(mergeMessages(have, [m(4, "a"), m(2, "b"), m(3, "b")]).map((x) => x.seq)).toEqual([1, 2, 3, 4]);
  });

  it("counts what the others wrote since the person last looked", () => {
    const all = [m(1, "me"), m(2, "b"), m(3, "me"), m(4, "b"), m(5, "c")];
    expect(unreadCount(all, "me", 0)).toBe(3);
    expect(unreadCount(all, "me", 2)).toBe(2);
    expect(unreadCount(all, "me", 5)).toBe(0);
  });
});
