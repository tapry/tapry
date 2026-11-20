// The session's text messages on a device: what it has, and what its person hasn't seen.
import type { ChatMessage } from "@tapry/shared";

/** `more` added to `have`: each message once, in order. */
export function mergeMessages(have: ChatMessage[], more: ChatMessage[]): ChatMessage[] {
  if (more.length === 0) return have;
  const bySeq = new Map(have.map((m) => [m.seq, m]));
  for (const m of more) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Messages from the others that arrived after the last one this person saw. */
export function unreadCount(messages: ChatMessage[], selfId: string, readSeq: number): number {
  return messages.filter((m) => m.seq > readSeq && m.participantId !== selfId).length;
}
