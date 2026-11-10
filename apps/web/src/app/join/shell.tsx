// The guest screens' frame (the "Tapry Guest" design): a framed card on the terracotta backdrop,
// with the studio's name and the step chips in its header. No hooks: used by server and client pages.
import type { ReactNode } from "react";
import { cn, Mark } from "@/components/ui";

export function GuestShell({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ember px-[22px] py-[30px]">
      <main className="ember-card flex w-full max-w-[920px] flex-col overflow-hidden rounded-[19px] bg-canvas text-text">
        <div className="flex items-center justify-between gap-3 border-b border-border px-[22px] py-3.5">
          <span className="flex min-w-0 items-center gap-[9px] text-[15px] font-medium">
            <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-accent text-accent-text">
              <Mark className="size-3.5" />
            </span>
            <span className="truncate">{title}</span>
          </span>
          {right}
        </div>
        {children}
      </main>
    </div>
  );
}

/** Two columns that stack under ~700 px: the camera on the left, the form or checks on the right. */
export function GuestGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-start gap-7 p-[clamp(20px,4vw,36px)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// Step 2 is the green room. Not "Tech check": that is the separate page a host sends beforehand.
const STEPS = ["Join", "Get ready", "Studio"];

/** Join → Get ready → Studio, with the current one highlighted and the done ones ticked. */
export function Steps({ current }: { current: number }) {
  return (
    <ol aria-label="Steps" className="flex items-center gap-1.5">
      {STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-[9px] py-1 text-[13px] font-medium whitespace-nowrap transition-colors duration-300",
            i === current && "bg-surface-2",
            i <= current ? "text-text" : "text-subtle",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "grid size-4 place-items-center rounded-full text-[10px]",
              // A fixed green dark enough for the white tick in both themes.
              i < current ? "bg-[#15803d] text-white" : i === current ? "bg-ink text-ink-text" : "bg-border text-muted",
            )}
          >
            {i < current ? "✓" : i + 1}
          </span>
          <span className="max-[620px]:sr-only">{label}</span>
          {i < current && <span className="sr-only">(done)</span>}
        </li>
      ))}
    </ol>
  );
}

/** The guest screens' heading block: 26 px title and a muted line under it. */
export function GuestHeading({ title, children, above }: { title: ReactNode; children?: ReactNode; above?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {above && <span className="text-[13px] text-muted">{above}</span>}
      <h1 className="text-[26px] leading-tight font-semibold tracking-[-.025em] text-balance">{title}</h1>
      {children && <p className="text-[14.5px] leading-normal text-pretty text-muted">{children}</p>}
    </div>
  );
}
