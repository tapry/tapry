"use client";

// Keeps a server-rendered page current while something on it is still moving (a recording
// being uploaded or processed): asks the server for the page again every few seconds.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function RefreshWhile({ active, everyMs = 5000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
