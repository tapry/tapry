import Link from "next/link";
import type { User } from "@/server/auth";
import { SignOutButton } from "./studio-forms";

export function HostHeader({ user }: { user: User }) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
        <Link href="/studios" className="font-semibold tracking-tight">
          OpenTake
        </Link>
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="hidden sm:inline">{user.email}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
