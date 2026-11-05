import Link from "next/link";
import type { ReactNode } from "react";
import { formatBytes } from "@/lib/format";
import type { User } from "@/server/auth";
import type { StudioWithUsage } from "@/server/studios";
import { LogOutButton } from "./studio-forms";
import { Avatar, cn, Logo, StatusDot } from "./ui";

/** The host's dashboard frame: studios in a sidebar, breadcrumb and account in the header. */
export function DashboardShell({
  user,
  studios,
  currentId,
  title,
  children,
}: {
  user: User;
  studios: StudioWithUsage[];
  currentId?: string;
  title?: string;
  children: ReactNode;
}) {
  const total = studios.reduce((n, s) => n + s.bytes, 0);
  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[minmax(210px,248px)_minmax(0,1fr)]">
      <aside className="flex flex-col border-b border-border bg-surface-2 lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
        <Link href="/studios" className="flex h-[68px] shrink-0 items-center border-b border-border px-[22px] text-text">
          <Logo />
        </Link>
        <div className="px-[22px] pt-[22px] pb-2 font-mono text-[11px] tracking-[.08em] text-subtle">YOUR STUDIOS</div>
        <nav className="flex flex-col gap-0.5 overflow-y-auto px-3 pb-3" aria-label="Studios">
          {studios.map((s) => {
            const on = s.id === currentId;
            return (
              <Link
                key={s.id}
                href={`/studios/${s.id}`}
                aria-current={on ? "page" : undefined}
                data-testid="studio-link"
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[15px] text-text",
                  on ? "border-border-strong bg-surface font-semibold" : "border-transparent hover:bg-surface",
                )}
              >
                <StatusDot tone={s.live ? "live" : "idle"} className="size-2" />
                <span className="flex-1 truncate">{s.name}</span>
                <span className="text-[13px] font-normal text-subtle">{s.recordings}</span>
              </Link>
            );
          })}
          <Link
            href="/studios/new"
            className="mt-1.5 rounded-lg border border-dashed border-border-strong px-3 py-2.5 text-[15px] font-medium text-muted hover:border-muted hover:text-text"
          >
            + New studio
          </Link>
        </nav>
        <div className="mt-auto hidden flex-col gap-2.5 border-t border-border px-[22px] py-5 text-sm lg:flex">
          <span className="flex justify-between text-muted">
            Space used
            <span className="font-semibold whitespace-nowrap text-text" data-testid="storage-total">
              {formatBytes(total)}
            </span>
          </span>
          <span className="text-[13px] text-subtle">
            across {studios.length} studio{studios.length === 1 ? "" : "s"}
          </span>
          {user.isAdmin && (
            <Link href="/admin/health" className="mt-1 text-[13px] text-muted hover:text-text">
              Server health →
            </Link>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-[68px] items-center justify-between gap-4 border-b border-border px-5 sm:px-8">
          <span className="min-w-0 flex-1 truncate text-[15px] text-muted">
            Studios
            {title && (
              <>
                <span className="mx-1.5">/</span>
                <span className="font-semibold text-text">{title}</span>
              </>
            )}
          </span>
          <div className="flex items-center gap-2.5">
            <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
            <Avatar name={user.name} />
            <LogOutButton />
          </div>
        </header>
        <main className="flex w-full max-w-[1140px] flex-col gap-7 px-5 pt-10 pb-16 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
