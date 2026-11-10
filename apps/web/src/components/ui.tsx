// Small set of UI primitives in the shadcn style, without the Radix dependency tree.
// Look and feel: the "Tapry … Tembo" designs (zinc neutrals, terracotta accent, 6px controls, Geist).
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "record" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  // Dark, for everyday actions (Copy link, Save changes, Log in).
  primary: "bg-ink text-ink-text hover:bg-ink-hover",
  // Terracotta, for the one main action on a screen (Record, Join the studio).
  record: "bg-accent text-accent-text hover:bg-accent-hover",
  secondary: "border border-border bg-surface text-text shadow-xs hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "border border-accent-line bg-surface text-accent-strong hover:bg-accent-soft",
  // Quiet text that acts ("Delete recording…"): no box, so it takes no size.
  link: "text-[13.5px] text-muted hover:text-accent-strong",
};

// Pick a size here rather than overriding height or padding with className: Tailwind orders
// same-property classes by value, not by where they're written, so "h-9" loses to "h-10".
const sizes: Record<Size, string> = {
  sm: "h-9 rounded-md px-3 text-sm",
  md: "h-10 rounded-md px-4 text-[14.5px]",
  lg: "h-11 rounded-[10px] px-5 text-[15px]",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button({ variant = "primary", size = "md", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        variant !== "link" && "font-medium",
        variant !== "link" && sizes[size],
        className,
      )}
      {...props}
    />
  );
});

/** The white dot in terracotta buttons that start something (Record, Join the studio). */
export function RecDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("size-[9px] rounded-full bg-current", className)} />;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-md border border-border bg-surface min-h-[120px] px-3 py-2.5 leading-normal text-[14.5px] text-text shadow-xs transition-[border-color,box-shadow] placeholder:text-subtle",
        "focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    />
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-[38px] w-full rounded-md border border-border bg-surface px-3 text-[14.5px] text-text shadow-xs transition-[border-color,box-shadow] placeholder:text-subtle",
        "focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    />
  );
});

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-[38px] w-full rounded-md border border-border bg-surface px-3 text-[14.5px] text-text shadow-xs transition-[border-color,box-shadow]",
        "focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-[13px] text-muted">{hint}</span>}
    </label>
  );
}

/** A labelled checkbox with an explanation underneath, as in the settings and check-in screens. */
export function CheckboxRow({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-[1.45] text-text-2", className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0" {...props} />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-text">{label}</span>
        {description && <span className="text-[13px] leading-normal text-muted">{description}</span>}
      </span>
    </label>
  );
}

type Tone = "info" | "ok" | "warn" | "danger";

const tones: Record<Tone, string> = {
  info: "border border-border bg-surface text-text-2",
  ok: "bg-ok-soft text-ok-strong",
  warn: "bg-warn-soft text-warn-strong",
  danger: "bg-accent-soft text-accent-strong",
};

export function Notice({ tone = "info", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-lg px-3.5 py-3 text-sm leading-normal", tones[tone], className)}
    >
      {children}
    </div>
  );
}

type DotTone = "ok" | "warn" | "danger" | "idle" | "live";

export function StatusDot({ tone, className }: { tone: DotTone; className?: string }) {
  const color = { ok: "bg-ok", warn: "bg-warn", danger: "bg-accent", idle: "bg-border-strong", live: "bg-accent animate-rec-pulse" }[tone];
  return <span aria-hidden className={cn("inline-block size-[7px] shrink-0 rounded-full", color, className)} />;
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

// Calm, distinct backgrounds for people without a camera picture (same in both themes).
const AVATAR_COLORS = ["#fbd5cc", "#d6e4ff", "#e3d9ff", "#d4f0e0", "#fde7c2", "#f9d4e6"];

/** Round initials avatar. The color is stable per name. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-[#18181b]", className ?? "size-9 text-[13px]")}
      style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }}
    >
      {initials(name)}
    </span>
  );
}

/** The Tapry glyph: three strokes meeting, like tracks joining into one. */
export function Mark({ className, strokeWidth = 2.6 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" className={className}>
      <path d="M12 3v18M5 8l7 4l7-4M5 16l7-4l7 4" />
    </svg>
  );
}

/** The Tapry logo: the glyph on a terracotta tile, then the name. */
export function Logo({ className, tile = "size-[26px] rounded-[7px]" }: { className?: string; tile?: string }) {
  return (
    <span className={cn("flex items-center gap-[9px] text-base font-medium", className)}>
      <span className={cn("grid shrink-0 place-items-center bg-accent text-accent-text", tile)}>
        <Mark className="size-[58%]" />
      </span>
      Tapry
    </span>
  );
}
