// Small set of UI primitives in the shadcn style, without the Radix dependency tree.
// Look and feel: the "Tapry Dashboard / Pages" mock-ups (coral, ink, soft grey panels, Onest).
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "record" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

const variants: Record<Variant, string> = {
  // Dark, for everyday actions (Copy link, Save changes).
  primary: "rounded-full bg-ink text-ink-text hover:opacity-90",
  // Coral, for the one main action on a screen (Record, Enter studio, Join).
  record: "rounded-xl bg-accent text-accent-text shadow-[0_10px_22px_-12px_var(--accent)] hover:bg-accent-hover",
  secondary: "rounded-full border border-border-strong bg-transparent text-text hover:border-muted",
  ghost: "rounded-full text-muted hover:bg-surface-2 hover:text-text",
  danger: "rounded-full border border-accent bg-transparent text-accent-strong hover:bg-accent-soft",
};

const sizes: Record<Size, string> = {
  md: "h-11 px-5 text-[15px]",
  lg: "h-[52px] px-7 text-base",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button({ variant = "primary", size = "md", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 font-semibold whitespace-nowrap transition",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});

/** The white dot in coral buttons that start something (Record, Enter studio, Join). */
export function RecDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("size-2.5 rounded-full bg-current", className)} />;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[120px] w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-[15px] leading-normal placeholder:text-subtle",
        "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
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
        "h-[50px] w-full rounded-xl border border-border-strong bg-surface px-4 text-[15px] placeholder:text-subtle",
        "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
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
        "h-12 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-[15px]",
        "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-[7px]">
      <span className="text-[15px] font-medium">{label}</span>
      {children}
      {hint && <span className="text-[13px] text-subtle">{hint}</span>}
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
    <label className={cn("flex cursor-pointer items-start gap-3.5 text-[15px]", className)}>
      <input type="checkbox" className="mt-[3px] size-[18px] shrink-0" {...props} />
      <span className="flex flex-col gap-[3px]">
        <span className="font-medium">{label}</span>
        {description && <span className="text-sm leading-normal text-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Soft grey panel: the dashboard's sections and the studio's side panel. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-[20px] bg-surface-2 p-6", className)}>{children}</div>;
}

type Tone = "info" | "ok" | "warn" | "danger";

const tones: Record<Tone, string> = {
  info: "bg-surface-2 text-text-2",
  ok: "bg-ok-soft text-ok-strong",
  warn: "bg-warn-soft text-warn-strong",
  danger: "bg-accent-soft text-accent-strong",
};

export function Notice({ tone = "info", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-xl px-4 py-3.5 text-sm leading-normal", tones[tone], className)}
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

const pillTones: Record<Exclude<DotTone, "idle">, string> = {
  ok: "border-ok-line text-ok-strong",
  warn: "border-warn-line text-warn-strong",
  danger: "border-accent-line text-accent-strong",
  live: "border-accent-line text-accent-strong",
};

/** Status with a dot in a rounded outline: "Ready to download", "Recording now". */
export function StatusPill({
  tone,
  children,
  className,
  ...props
}: { tone: Exclude<DotTone, "idle">; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap",
        pillTones[tone],
        className,
      )}
      {...props}
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

/** Small mono uppercase label above headings ("SHOW", "BEFORE YOU GO IN"). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs tracking-[.12em] text-accent-strong uppercase", className)}>{children}</span>;
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

// Calm, distinct backgrounds for people without a camera picture.
const AVATAR_COLORS = ["#fbd5cc", "#d6e4ff", "#e3d9ff", "#d4f0e0", "#fde7c2", "#f9d4e6"];

/** Round initials avatar. The color is stable per name. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-[#1d1d1f]", className ?? "size-9 text-[13px]")}
      style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }}
    >
      {initials(name)}
    </span>
  );
}

/** The Tapry mark: a coral dot with a soft offset shadow. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-[19px] font-bold tracking-[-.02em]", className)}>
      <span aria-hidden className="relative size-[22px]">
        <span className="absolute inset-0 translate-x-1 translate-y-[3px] rounded-full bg-accent-line" />
        <span className="absolute inset-0 rounded-full bg-accent" />
      </span>
      Tapry
    </span>
  );
}

export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return (
    <main className={cn("mx-auto w-full px-4 py-10 sm:px-6", narrow ? "max-w-md" : "max-w-4xl")}>{children}</main>
  );
}
