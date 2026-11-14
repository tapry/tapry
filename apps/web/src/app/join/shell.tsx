// The guest screens' frame (the "Tapry Guest" design): a framed card on the terracotta backdrop,
// with the studio's name and the step chips in its header. No hooks: used by server and client pages.
import type { CSSProperties, ReactNode } from "react";
import { dirOf, translate, type Locale } from "@/lib/i18n";
import { LanguagePicker } from "@/lib/i18n/client";
import type { Brand } from "@/server/brand";
import { cn, LogoMark } from "@/components/ui";

/**
 * With a studio's `brand`, its logo stands where Tapry's mark is and its colour replaces the
 * terracotta. With a `locale`, the frame reads in that language's direction and offers the
 * other languages under the card.
 */
export function GuestShell({ title, right, children, brand, locale }: { title: ReactNode; right?: ReactNode; children: ReactNode; brand?: Brand | null; locale?: Locale }) {
  return (
    <div
      lang={locale}
      dir={locale ? dirOf(locale) : undefined}
      className={cn("flex min-h-dvh flex-col items-center justify-center gap-4 bg-ember px-[22px] py-[30px]", brand?.accent && "branded")}
      style={brand?.accent ? ({ "--brand": brand.accent, "--brand-text": brand.accentText ?? "#ffffff" } as CSSProperties) : undefined}
    >
      <main className="ember-card flex w-full max-w-[920px] flex-col overflow-hidden rounded-[19px] bg-canvas text-text">
        <div className="flex items-center justify-between gap-3 border-b border-border px-[22px] py-3.5">
          <span className="flex min-w-0 items-center gap-[9px] text-[16px] font-medium">
            {brand?.logoUrl ? (
              // The studio's own picture: any size, shown at the mark's height.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt="" data-testid="brand-logo" className="h-6 w-auto max-w-[120px] shrink-0 rounded-[4px] object-contain" />
            ) : (
              <LogoMark className="size-6" />
            )}
            <span className="truncate">{title}</span>
          </span>
          {right}
        </div>
        {children}
      </main>
      {locale && <LanguagePicker locale={locale} label={translate(locale, "lang.label")} />}
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
const STEPS = ["steps.join", "steps.ready", "steps.studio"] as const;

/** Join → Get ready → Studio, with the current one highlighted and the done ones ticked. */
export function Steps({ current, locale = "en" }: { current: number; locale?: Locale }) {
  return (
    <ol aria-label={translate(locale, "steps.label")} className="flex items-center gap-1.5">
      {STEPS.map((key, i) => [translate(locale, key), i] as const).map(([label, i]) => (
        <li
          key={label}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-[9px] py-1 text-[14px] font-medium whitespace-nowrap transition-colors duration-300",
            i === current && "bg-surface-2",
            i <= current ? "text-text" : "text-subtle",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "grid size-4 place-items-center rounded-full text-[11px]",
              // A fixed green dark enough for the white tick in both themes.
              i < current ? "bg-[#15803d] text-white" : i === current ? "bg-ink text-ink-text" : "bg-border text-muted",
            )}
          >
            {i < current ? "✓" : i + 1}
          </span>
          <span className="max-[620px]:sr-only">{label}</span>
          {i < current && <span className="sr-only">{translate(locale, "steps.done")}</span>}
        </li>
      ))}
    </ol>
  );
}

/** The guest screens' heading block: 26 px title and a muted line under it. */
export function GuestHeading({ title, children, above }: { title: ReactNode; children?: ReactNode; above?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {above && <span className="text-[14px] text-muted">{above}</span>}
      <h1 className="text-[27px] leading-tight font-semibold tracking-[-.025em] text-balance">{title}</h1>
      {children && <p className="text-[15.5px] leading-normal text-pretty text-muted">{children}</p>}
    </div>
  );
}
