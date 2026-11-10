"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Icon, Spinner } from "@/components/ui-extra";

/** Searches every transcript as you type: the page reloads its list from the server with ?q=. */
export function TranscriptSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState(initial);
  const [pending, start] = useTransition();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => start(() => router.replace(q.trim() ? `${path}?q=${encodeURIComponent(q.trim())}` : path, { scroll: false })), 300);
    return () => clearTimeout(id);
  }, [q, path, router]);
  return (
    <label className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-muted shadow-xs focus-within:border-ring focus-within:shadow-[0_0_0_3px_var(--ring-soft)]">
      {pending ? <Spinner size={15} /> : <Icon name="search" size={15} />}
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search every transcript"
        aria-label="Search transcripts"
        maxLength={100}
        className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-subtle"
      />
    </label>
  );
}
