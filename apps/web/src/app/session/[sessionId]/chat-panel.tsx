"use client";

// Text messages between the people in the session. They go through the server (so they work
// when the call doesn't), live in its memory while the session is open and are never stored,
// logged or put in a recording.
import { CHAT_MAX_CHARS, type ChatMessage, type SessionTicket } from "@tapry/shared";
import { useEffect, useRef, useState, type RefObject } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { mergeMessages, unreadCount } from "@/lib/client/chat";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/components/ui";
import { Icon, ICON } from "./icons";

/**
 * This device's copy of the session's messages. `chatSeq` is the newest message's number from
 * the live session state: when it is ahead of what we have, the missing ones are fetched, so a
 * device that was offline catches up by itself.
 */
export function useChat(ticket: SessionTicket, chatSeq: number, open: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [readSeq, setReadSeq] = useState(0);
  const have = messages.at(-1)?.seq ?? 0;
  const fetching = useRef(false);

  useEffect(() => {
    if (chatSeq <= have || fetching.current) return;
    fetching.current = true;
    let gone = false;
    apiFetch<{ messages: ChatMessage[] }>(`/sessions/${ticket.sessionId}/chat?after=${have}`, { token: ticket.token })
      .then((r) => !gone && setMessages((m) => mergeMessages(m, r.messages)))
      .catch(() => {})
      .finally(() => {
        fetching.current = false;
      });
    return () => {
      gone = true;
      fetching.current = false;
    };
  }, [chatSeq, have, ticket.sessionId, ticket.token]);

  // Seen: whatever is there while the panel is open.
  useEffect(() => {
    if (open && have > readSeq) setReadSeq(have);
  }, [open, have, readSeq]);

  async function send(text: string) {
    const message = await apiFetch<ChatMessage>(`/sessions/${ticket.sessionId}/chat`, { body: { text }, token: ticket.token });
    setMessages((m) => mergeMessages(m, [message]));
  }

  return { messages, unread: open ? 0 : unreadCount(messages, ticket.participantId, readSeq), send };
}

/** Open or closed, Escape to close (before full screen hears it), focus back to the button. */
export function useChatPanel() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !panel.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  return { open, toggle: () => setOpen((o) => !o), close: () => setOpen(false), button, panel };
}

/** The unread count on the Chat button. */
export function ChatDot({ count }: { count: number }) {
  return (
    <span
      data-testid="chat-unread"
      className="absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-[#18181b] bg-accent px-[3px] font-mono text-[10.5px] leading-none font-medium text-accent-text"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

export function ChatPanel({
  id,
  panelRef,
  messages,
  names,
  selfId,
  onSend,
  onClose,
  className,
}: {
  id?: string;
  panelRef?: RefObject<HTMLDivElement | null>;
  messages: ChatMessage[];
  /** Display names by participant id. */
  names: Map<string, string>;
  selfId: string;
  onSend: (text: string) => Promise<void>;
  onClose: () => void;
  className?: string;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const newest = messages.at(-1)?.seq ?? 0;
  // The newest message is always in view.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [newest]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onSend(text);
      setDraft("");
    } catch (err) {
      setProblem(err instanceof ApiRequestError && err.code === "too_many_messages" ? t("chat.slowDown") : t("chat.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={panelRef}
      id={id}
      role="group"
      aria-label={t("chat.title")}
      data-testid="chat-panel"
      className={cn("flex flex-col gap-2.5 overflow-hidden rounded-xl border border-white/12 bg-[#232326] p-3.5 text-sm text-white shadow-[0_18px_40px_-12px_rgba(0,0,0,.7)]", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium" title={t("chat.notSaved")}>
          {t("chat.title")}
        </span>
        <button
          type="button"
          aria-label={t("chat.close")}
          onClick={onClose}
          className="grid size-7 cursor-pointer place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Icon d={ICON.close} className="size-[15px]" />
        </button>
      </div>
      <div ref={list} role="log" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto border-t border-white/10 pt-2.5">
        {messages.length === 0 ? (
          <span className="m-auto max-w-[250px] text-center text-[14px] leading-snug text-white/60">
            {t("chat.empty")} {t("chat.notSaved")}
          </span>
        ) : (
          messages.map((m) => {
            const own = m.participantId === selfId;
            return (
              <div key={m.seq} data-testid="chat-message" className={cn("flex max-w-[88%] flex-col gap-0.5", own ? "self-end items-end" : "self-start")}>
                <span className="text-[12.5px] text-white/55">
                  {own ? t("chat.you") : (names.get(m.participantId) ?? "…")} · <time className="font-mono">{clockTime(m.at)}</time>
                </span>
                <span dir="auto" className={cn("rounded-lg px-2.5 py-1.5 text-[14.5px] leading-snug break-words whitespace-pre-wrap", own ? "bg-accent text-accent-text" : "bg-white/10")}>
                  {m.text}
                </span>
              </div>
            );
          })
        )}
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a new line. Not while a word is still being composed.
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void send();
          }}
          rows={1}
          maxLength={CHAT_MAX_CHARS}
          dir="auto"
          aria-label={t("chat.placeholder")}
          placeholder={t("chat.placeholder")}
          className="min-w-0 flex-1 resize-none rounded-md border border-white/15 bg-white/8 px-2.5 py-1.5 text-[14.5px] leading-snug text-white placeholder:text-white/45 focus:border-white/40 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="h-9 shrink-0 cursor-pointer rounded-md bg-white px-3 text-sm font-medium text-[#18181b] transition-colors hover:bg-[#e4e4e7] disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:h-11"
        >
          {t("chat.send")}
        </button>
      </form>
      {problem && (
        <span role="alert" className="text-[13.5px] text-[#fca5a5]">
          {problem}
        </span>
      )}
    </div>
  );
}

/** The time on this device's clock, as it writes times. */
function clockTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
