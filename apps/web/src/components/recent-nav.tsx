"use client";

import Link from "next/link";
import { shortClock } from "@/lib/format";
import { Faces } from "./faces";
import { LiveClock } from "./live-clock";
import { STATUS, type StatusTone } from "./recordings";
import { Icon, type IconName } from "./ui-extra";
import { cn } from "./ui";

export interface PageLink {
  key: string;
  href: string;
  icon: IconName;
  label: string;
}

/** The sidebar's pages (Home, Recordings, Guests, …): plain data, for the same reason as RecentNav. */
export function PageNav({ items, active }: { items: PageLink[]; active?: string }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Pages">
      {items.map((n) => {
        const on = n.key === active;
        return (
          <Link
            key={n.key}
            href={n.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-[11px] rounded-md p-2 text-[14.5px] whitespace-nowrap text-text-2 transition-colors duration-200 hover:bg-surface-2 hover:text-text-2",
              on && "bg-surface-2 font-medium text-text",
            )}
          >
            <Icon name={n.icon} size={17} className="text-muted" />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

export interface RecentItem {
  id: string;
  number: number;
  studioId: string;
  studioName: string;
  startedAt: number;
  stoppedAt: number | null;
  tone: StatusTone;
  label: string;
  people: string[];
}

/**
 * The sidebar's newest recordings across the host's studios. A client component given plain
 * data: the sidebar is handed from the server to AppFrame as a prop, and a keyed list of
 * elements inside that prop makes React warn about keys in development.
 */
export function RecentNav({ items, serverNow, currentId }: { items: RecentItem[]; serverNow: number; currentId?: string }) {
  if (items.length === 0) return <span className="px-2 py-1.5 text-[13px] text-muted">Nothing recorded yet</span>;
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Recent recordings">
      {items.map((r) => {
        const s = STATUS[r.tone];
        const live = r.tone === "live";
        const on = r.id === currentId;
        return (
          <Link
            key={r.id}
            // A running recording is in the studio; a finished one has its own page.
            href={live ? `/studios/${r.studioId}` : `/recordings/${r.id}`}
            aria-current={on ? "page" : undefined}
            title={r.label}
            className={cn(
              "grid shrink-0 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-[9px] gap-y-[3px] rounded-md p-2 text-left text-text transition-colors hover:bg-surface-2 hover:text-text",
              on && "bg-surface-2",
            )}
          >
            <Icon name={s.icon} className={cn(s.color, live && s.anim)} />
            <span className="truncate text-sm">Recording {r.number}</span>
            <span className={cn("font-mono text-[11.5px] whitespace-nowrap", live ? "text-accent-strong" : "text-muted")}>
              {live ? <LiveClock startedAt={r.startedAt} serverNow={serverNow} /> : shortClock((r.stoppedAt ?? r.startedAt) - r.startedAt)}
            </span>
            <span />
            <span className="flex min-w-0 gap-[5px] text-[12.5px] whitespace-nowrap text-muted">
              <span className={cn("shrink-0", s.color)}>{r.label}</span>
              <span className="min-w-0 truncate">· {r.studioName}</span>
            </span>
            <Faces names={r.people} size="xs" className="justify-end" />
          </Link>
        );
      })}
    </nav>
  );
}
