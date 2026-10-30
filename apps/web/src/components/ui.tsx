// Small set of UI primitives in the shadcn style, without the Radix dependency tree.
// Swap for generated shadcn/ui components when we need menus, dialogs, etc.
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "record" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-text text-bg hover:opacity-90",
  record: "bg-accent text-accent-text hover:opacity-90",
  secondary: "bg-surface-2 text-text border border-border hover:bg-border/60",
  ghost: "text-muted hover:text-text hover:bg-surface-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>(
  function Button({ variant = "primary", className, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition",
          "disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm placeholder:text-muted",
        className,
      )}
      {...props}
    />
  );
});

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("h-10 w-full rounded-md border border-border bg-surface px-3 text-sm", className)}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl border border-border bg-surface p-6", className)}>{children}</div>;
}

type Tone = "info" | "ok" | "warn" | "danger";

const tones: Record<Tone, string> = {
  info: "border-border bg-surface-2",
  ok: "border-ok/40 bg-ok/10",
  warn: "border-warn/40 bg-warn/10",
  danger: "border-danger/40 bg-danger/10",
};

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "danger" | "idle" }) {
  const color = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", idle: "bg-muted" }[tone];
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", color)} />;
}

export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return (
    <main className={cn("mx-auto w-full px-4 py-10 sm:px-6", narrow ? "max-w-md" : "max-w-4xl")}>{children}</main>
  );
}
