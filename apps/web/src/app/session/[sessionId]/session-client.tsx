"use client";

import type { SessionTicket } from "@opentake/shared";
import { useEffect, useState } from "react";
import { Eyebrow, Notice } from "@/components/ui";
import { loadTicket } from "@/lib/client/api";
import { getPipeline } from "@/lib/client/recording";
import { GreenRoom, type ReadyToJoin } from "./green-room";
import { Room } from "./room";

export function SessionClient({ sessionId }: { sessionId: string }) {
  // undefined = still reading storage; null = no ticket in this browser.
  const [ticket, setTicket] = useState<SessionTicket | null | undefined>(undefined);
  const [ready, setReady] = useState<ReadyToJoin | null>(null);

  useEffect(() => setTicket(loadTicket(sessionId)), [sessionId]);
  // Upload anything a crashed or closed tab left behind, as early as possible.
  useEffect(() => void getPipeline(), []);

  if (ticket === undefined) return null;
  if (ticket === null) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16">
        <Notice tone="warn">
          This browser isn&apos;t part of this session. Guests: open the invite link your host sent you. Hosts: enter the
          studio from your show&apos;s page.
        </Notice>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-5 py-8 sm:px-12 sm:py-12">
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Before you go in</Eyebrow>
          <h1 className="text-[clamp(28px,3.2vw,40px)] font-bold tracking-[-.03em]">{ticket.studio.name}</h1>
          <p className="text-base text-muted">Check how you look and sound before you go in. This only takes a moment.</p>
        </div>
        <GreenRoom ticket={ticket} onJoin={setReady} />
      </div>
    );
  }
  return <Room ticket={ticket} ready={ready} />;
}
