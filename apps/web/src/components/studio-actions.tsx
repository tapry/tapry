"use client";

// The dashboard's actions on a studio: enter it (the host's session), and copy its guest link.
// The same calls as the studio page's buttons; a short note at the bottom says what happened.
import type { SessionTicket } from "@tapry/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiRequestError, saveTicket } from "@/lib/client/api";
import { Icon, Spinner } from "./ui-extra";
import { cn } from "./ui";

/** "Guest link copied": the designs' toast, bottom centre, gone after a moment. */
export function useToast() {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (t: string) => {
    clearTimeout(timer.current);
    setText(t);
    timer.current = setTimeout(() => setText(null), 2200);
  };
  const toast = text ? (
    <div
      role="status"
      className="fixed bottom-7 left-1/2 z-40 max-w-[calc(100vw-32px)] -translate-x-1/2 animate-pop rounded-md bg-ink px-3.5 py-2 text-sm text-ink-text shadow-[0_10px_30px_-10px_rgba(0,0,0,.4)]"
    >
      {text}
    </div>
  ) : null;
  return { show, toast };
}

const looks = {
  /** The top bar's bordered button. */
  top: "h-8 rounded-md border border-border bg-surface px-3 text-sm font-medium text-text hover:border-ink",
  /** A page's dark main button ("Open studio" on Recordings). */
  dark: "h-[34px] rounded-md bg-ink px-3.5 text-sm font-medium text-ink-text hover:bg-ink-hover",
  /** A studio card's terracotta Record. */
  record: "h-9 flex-1 justify-center rounded-md bg-accent px-3.5 text-sm font-medium text-accent-text hover:bg-accent-hover",
} as const;

/** Enters the studio as its host (reusing its open session), like the studio page's Enter studio. */
export function OpenStudioAction({
  studioId,
  label,
  look,
  iconOnlyOnPhone = false,
}: {
  studioId: string | null;
  label: string;
  look: keyof typeof looks;
  iconOnlyOnPhone?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { show, toast } = useToast();
  const cls = cn("inline-flex shrink-0 cursor-pointer items-center gap-[7px] whitespace-nowrap transition-colors disabled:opacity-60", looks[look]);
  const icon =
    look === "record" ? (
      <span aria-hidden className="size-2 rounded-full bg-current" />
    ) : look === "top" ? (
      <Icon name="camera" size={15} />
    ) : null;
  const text = <span className={iconOnlyOnPhone ? "hidden sm:inline" : undefined}>{label}</span>;

  // No studio yet: the first step is making one.
  if (!studioId) {
    return (
      <Link href="/studios/new" className={cls} aria-label={iconOnlyOnPhone ? "New studio" : undefined}>
        <Icon name="plus" size={15} />
        <span className={iconOnlyOnPhone ? "hidden sm:inline" : undefined}>New studio</span>
      </Link>
    );
  }

  async function open() {
    setBusy(true);
    try {
      const ticket = await apiFetch<SessionTicket>(`/studios/${studioId}/open`, { body: {} });
      saveTicket(ticket);
      router.push(`/session/${ticket.sessionId}`);
    } catch (err) {
      show(err instanceof ApiRequestError ? err.message : "Couldn't open the studio. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={open} disabled={busy} className={cls} aria-label={iconOnlyOnPhone ? label : undefined}>
        {busy ? <Spinner size={15} /> : icon}
        {text}
      </button>
      {toast}
    </>
  );
}

/** Copies a studio's guest link. `icon`: the top bar's link button; `dark`: a page's main button. */
export function CopyGuestLink({ inviteCode, studioName, look, label = "Copy guest link" }: { inviteCode: string; studioName?: string; look: "icon" | "dark"; label?: string }) {
  const { show, toast } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${inviteCode}`);
      show(studioName ? `Guest link for ${studioName} copied` : "Guest link copied");
    } catch {
      show("Couldn't copy. Open the studio and copy the link from there.");
    }
  }
  return (
    <>
      {look === "icon" ? (
        <button
          type="button"
          onClick={copy}
          aria-label={label}
          title={label}
          className="grid size-8 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Icon name="link" size={17} />
        </button>
      ) : (
        <button type="button" onClick={copy} className={cn("inline-flex shrink-0 cursor-pointer items-center gap-[7px] whitespace-nowrap transition-colors", looks.dark)}>
          {label}
        </button>
      )}
      {toast}
    </>
  );
}
