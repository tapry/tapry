"use client";

import type { SessionTicket } from "@tapry/shared";
import { useEffect, useState } from "react";
import { Notice } from "@/components/ui";
import { loadTicket } from "@/lib/client/api";
import { getPipeline } from "@/lib/client/recording";
import { holdSessionLock } from "@/lib/client/session-lock";
import { dirOf, translate, type Locale, type MessageKey } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/client";
import type { Brand } from "@/server/brand";
import { GuestHeading, GuestShell, Steps } from "../../join/shell";
import { GreenRoom, type ReadyToJoin } from "./green-room";
import { Room } from "./room";

export function SessionClient({ sessionId, brand, locale: guestLocale = "en" }: { sessionId: string; brand?: Brand | null; /** The language for a guest; a host's studio is in English like their dashboard. */ locale?: Locale }) {
  // undefined = still reading storage; null = no ticket in this browser.
  const [ticket, setTicket] = useState<SessionTicket | null | undefined>(undefined);
  const [ready, setReady] = useState<ReadyToJoin | null>(null);

  const [tab, setTab] = useState<"checking" | "held" | "elsewhere">("checking");

  useEffect(() => setTicket(loadTicket(sessionId)), [sessionId]);
  useEffect(() => {
    setTab("checking");
    return holdSessionLock(
      sessionId,
      () => {
        setTab("held");
        // The other tab may have been someone else joining, with a newer ticket.
        setTicket(loadTicket(sessionId));
      },
      () => setTab("elsewhere"),
    );
  }, [sessionId]);
  // Upload anything a crashed or closed tab left behind, as early as possible.
  useEffect(() => void getPipeline(), []);

  if (ticket === undefined) return null;
  if (ticket === null) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Notice tone="warn">
          This browser isn&apos;t part of this session. Guests: open the invite link your host sent you. Hosts: enter the
          studio from your studio&apos;s page.
        </Notice>
      </div>
    );
  }
  if (tab === "checking") return null;
  if (tab === "elsewhere") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Notice tone="warn">
          <span data-testid="open-elsewhere">
            This session is already open in another tab. Use that one, or close it and this page continues by itself. Two tabs would
            record you twice.
          </span>
        </Notice>
      </div>
    );
  }
  // Guests read the room in their language; a host's studio is in English, like their dashboard.
  const locale: Locale = ticket.role === "guest" ? guestLocale : "en";
  const t = (key: MessageKey) => translate(locale, key);
  if (!ready) {
    const intro = (
      <GuestHeading title={t("gr.title")} above={ticket.role === "host" ? ticket.studio.name : undefined}>
        {t("gr.body")}
      </GuestHeading>
    );
    // Guests come from the invite page: the same framed card, at step 2. Hosts get the plain studio page.
    if (ticket.role === "guest") {
      return (
        <GuestShell title={ticket.studio.name} right={<Steps current={1} locale={locale} />} brand={brand} locale={locale}>
          <div className="flex animate-fade-up flex-col gap-[22px] p-[clamp(20px,4vw,36px)]">
            {intro}
            <LocaleProvider locale={locale}>
              <GreenRoom ticket={ticket} onJoin={setReady} />
            </LocaleProvider>
          </div>
        </GuestShell>
      );
    }
    return (
      <div className="mx-auto flex w-full max-w-[960px] animate-fade-up flex-col gap-[22px] px-[clamp(16px,4vw,44px)] py-7">
        {intro}
        <GreenRoom ticket={ticket} onJoin={setReady} />
      </div>
    );
  }
  return (
    <LocaleProvider locale={locale}>
      <div lang={locale} dir={dirOf(locale)} className="contents">
        <Room ticket={ticket} ready={ready} />
      </div>
    </LocaleProvider>
  );
}
