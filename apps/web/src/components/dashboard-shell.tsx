import Link from "next/link";
import type { ReactNode } from "react";
import type { User } from "@/server/auth";
import { getServices } from "@/server/context";
import type { StudioWithUsage } from "@/server/studios";
import { AppFrame, CollapseSidebar } from "./app-frame";
import { shortStatus } from "./recordings";
import { PageNav, RecentNav, type PageLink, type RecentItem } from "./recent-nav";
import { ConfirmEmailNotice } from "./confirm-email";
import { CopyGuestLink, OpenStudioAction } from "./studio-actions";
import { LogOutButton } from "./studio-forms";
import type { IconName } from "./ui-extra";
import { Avatar, LogoMark } from "./ui";

export type NavKey = "recordings" | "guests" | "transcripts" | "studios" | "storage" | "settings" | "health";

const NAV: Array<{ key: NavKey | "home"; href: string; icon: IconName; label: string; admin?: boolean }> = [
  { key: "home", href: "/studios", icon: "home", label: "Home" },
  { key: "recordings", href: "/recordings", icon: "chat", label: "Recordings" },
  { key: "guests", href: "/guests", icon: "guests", label: "Guests" },
  { key: "transcripts", href: "/transcripts", icon: "wave", label: "Transcripts" },
  { key: "studios", href: "/studios/all", icon: "studios", label: "Studios" },
  { key: "storage", href: "/storage", icon: "storage", label: "Storage" },
  { key: "settings", href: "/settings", icon: "settings", label: "Settings" },
  { key: "health", href: "/admin/health", icon: "pulse", label: "Server health", admin: true },
];

/**
 * The host's dashboard frame (Studio Tembo design): the sidebar with the pages, the newest
 * recordings and the account; the top bar with the page's name, the studio's guest link and
 * Open studio.
 */
export async function DashboardShell({
  user,
  studios,
  currentId,
  current,
  currentRecordingId,
  title,
  children,
}: {
  user: User;
  studios: StudioWithUsage[];
  /** The studio the page is about: a studio page (Home), or a recording's studio. */
  currentId?: string;
  /** Which sidebar item is the page; a studio page without it is Home. */
  current?: NavKey;
  /** A recording's page: its row in the sidebar's recent recordings is marked. */
  currentRecordingId?: string;
  title?: string;
  children: ReactNode;
}) {
  const services = await getServices();
  const serverNow = Date.now();
  const recent: RecentItem[] = (await services.processing.listForOwner(user, { limit: 5 })).map((r) => ({
    id: r.id,
    number: r.number,
    studioId: r.studioId,
    studioName: r.studioName,
    startedAt: r.startedAt,
    stoppedAt: r.stoppedAt,
    ...shortStatus(r),
    people: r.people.map((p) => p.name),
  }));
  const active = current ?? (currentId ? "home" : undefined);
  const studio = studios.find((s) => s.id === currentId);
  const target = studio ?? studios[0];

  const sidebar = (
    <div className="flex h-full w-[248px] flex-col gap-0.5 overflow-x-hidden overflow-y-auto border-r border-border px-3 pt-3.5">
      <div className="flex items-center justify-between gap-2 px-1 pt-0.5 pb-3.5 whitespace-nowrap">
        <Link href="/studios" aria-label="Tapry home" className="flex items-center gap-[9px] text-[15px] font-medium text-text hover:text-text">
          <LogoMark className="size-6" />
          Tapry
        </Link>
        <span className="flex gap-1">
          <Link
            href="/studios/new"
            aria-label="New studio"
            title="New studio"
            className="grid size-7 place-items-center rounded-md border border-border bg-surface text-[15px] text-muted transition-colors hover:border-ink hover:text-text"
          >
            +
          </Link>
          <CollapseSidebar />
        </span>
      </div>

      <PageNav items={pages(user)} active={active} />

      <span className="flex items-center justify-between px-2 pt-[18px] pb-1.5 text-[13px] whitespace-nowrap text-muted">
        Recent recordings
        <Link href="/recordings" className="text-[13px] text-muted hover:text-accent-strong">
          View all
        </Link>
      </span>
      <RecentNav items={recent} serverNow={serverNow} currentId={currentRecordingId} />

      <span className="sticky bottom-0 mt-auto flex shrink-0 items-center gap-2.5 border-t border-border bg-canvas px-2 pt-3 pb-3.5 whitespace-nowrap">
        <Avatar name={user.name} className="size-[26px] text-[10px]" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm">{user.name}</span>
          <span className="truncate text-[12.5px] text-muted" title={user.email}>
            {user.isAdmin ? "Admin" : "Host"} · {user.email}
          </span>
        </span>
        <LogOutButton />
      </span>
    </div>
  );

  return (
    <AppFrame
      sidebar={sidebar}
      crumbs={<span className="min-w-0 truncate text-[15px] font-medium">{title ?? "Studios"}</span>}
      actions={
        <>
          {studio && <CopyGuestLink inviteCode={studio.inviteCode} look="icon" />}
          <OpenStudioAction studioId={target?.id ?? null} label="Open studio" look="top" iconOnlyOnPhone />
          <span title={user.name} className="ml-1 hidden sm:inline-flex">
            <Avatar name={user.name} className="size-[26px] text-[10px]" />
          </span>
        </>
      }
    >
      {services.account.verificationRequired && !user.emailVerified && <ConfirmEmailNotice email={user.email} />}
      {children}
    </AppFrame>
  );
}

function pages(user: User): PageLink[] {
  return [
    ...NAV.filter((n) => !n.admin || user.isAdmin).map(({ key, href, icon, label }) => ({ key, href, icon, label })),
    { key: "upload-speed", href: "/tools/upload-speed", icon: "gauge", label: "Upload-speed check" },
  ];
}
