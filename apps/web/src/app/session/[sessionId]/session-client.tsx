"use client";

import type { SessionTicket } from "@opentake/shared";
import { useEffect, useState } from "react";
import { Notice } from "@/components/ui";
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
      <Notice tone="warn">
        This browser isn't part of this session. Guests: open the invite link your host sent you. Hosts: enter the
        studio from your studio page.
      </Notice>
    );
  }
  if (!ready) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">{ticket.studio.name}</h1>
        <p className="mb-6 mt-1 text-sm text-muted">Check your camera and microphone before you go in.</p>
        <GreenRoom ticket={ticket} onJoin={setReady} />
      </>
    );
  }
  return <Room ticket={ticket} ready={ready} />;
}
