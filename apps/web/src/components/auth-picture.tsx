"use client";

import { useEffect, useState } from "react";
import { EqBars } from "./ui-extra";
import { Avatar, cn } from "./ui";

const TRACKS = ["Host", "Guest 1", "Guest 2"];

/**
 * The sign-in screens' side panel: a recording card with one track per person, the speaker
 * moving round every few seconds. Decorative (aria-hidden): no real people or recordings.
 */
export function AuthPicture() {
  const [t, setT] = useState(0);
  // The clock only runs where the picture is shown (from 860px) and motion is welcome.
  useEffect(() => {
    const shown = window.matchMedia("(min-width: 860px)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let id: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(id);
      id = shown.matches && !still.matches ? setInterval(() => setT((x) => x + 1), 1000) : undefined;
    };
    sync();
    shown.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => {
      clearInterval(id);
      shown.removeEventListener("change", sync);
      still.removeEventListener("change", sync);
    };
  }, []);
  const pad = (n: number) => String(n).padStart(2, "0");
  const speaking = Math.floor(t / 4) % TRACKS.length;

  return (
    <aside
      aria-hidden
      className="hidden min-w-0 flex-col justify-between gap-6 border-l border-border p-9 min-[860px]:flex"
      style={{ background: "linear-gradient(200deg,var(--accent-tint) 0%,var(--accent-soft) 55%,var(--accent-line) 100%)" }}
    >
      <div className="flex flex-col gap-2.5">
        <h2 className="text-[24px] leading-[1.2] font-medium tracking-[-.025em] text-balance">
          Every voice on its own track, even when the Wi-Fi gives up.
        </h2>
        <p className="text-[14.5px] leading-[1.55] text-pretty text-text-2">
          Guests are recorded on their own computer and uploaded while you talk.
        </p>
      </div>
      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_30px_60px_-30px_rgba(110,50,30,.45)]">
        <div className="flex items-center gap-3.5 px-4 py-3.5" style={{ background: "linear-gradient(180deg,var(--accent-tint),var(--surface))" }}>
          <span className="relative grid size-11 place-items-center">
            <span className="absolute inset-0 animate-ring-slow rounded-full border-2 border-accent" />
            <span className="absolute inset-0 animate-ring-slow rounded-full border-2 border-accent [animation-delay:.8s]" />
            <span
              className="relative grid size-11 place-items-center rounded-full shadow-[0_0_0_4px_var(--surface),0_0_0_5px_var(--accent-line)]"
              style={{ background: "radial-gradient(circle at 35% 30%,var(--accent),var(--accent) 55%,var(--accent-strong))" }}
            >
              <span className="size-3.5 rounded-[3px] bg-accent-text" />
            </span>
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 self-start rounded-md bg-accent-soft px-[7px] py-px text-[11.5px] font-semibold text-accent-strong">
              <span className="size-[5px] animate-rec-pulse rounded-full bg-current" />
              Recording
            </span>
            <span className="text-[24px] leading-[1.1] font-medium tracking-[-.03em] tabular-nums">
              {pad(Math.floor(t / 60))}:{pad(t % 60)}
            </span>
          </span>
        </div>
        {TRACKS.map((name, i) => {
          const on = i === speaking;
          return (
            <div key={name} className="grid grid-cols-[30px_64px_minmax(30px,1fr)] items-center gap-2.5 border-t border-divider px-4 py-[9px]">
              <span className="relative grid size-[30px] place-items-center">
                {on && <span className="absolute inset-0 animate-ring rounded-full border-2 border-accent" />}
                <span className={cn("relative rounded-full", on ? "shadow-[0_0_0_2px_var(--accent)]" : "shadow-[0_0_0_2px_var(--surface)]")}>
                  <Avatar name={name} className="size-[30px] text-[11px]" />
                </span>
              </span>
              <span className="text-[13.5px] font-medium whitespace-nowrap">{name}</span>
              <span
                className={cn(
                  "flex h-7 min-w-0 items-center gap-2 rounded-full px-2.5 transition-colors duration-300",
                  on ? "bg-accent-soft" : "bg-surface-2",
                )}
              >
                <EqBars active={on} />
                <span className={cn("text-[11.5px] font-medium whitespace-nowrap", on ? "text-accent-strong" : "text-muted")}>
                  {on ? "Speaking" : "Listening"}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <span className="text-[13px] text-text-2">Open source · self-hosted · your storage</span>
    </aside>
  );
}
