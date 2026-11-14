"use client";

import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { hasAudioFilters, hasVideoFilters, LOOKS, NO_FILTERS, type Look, type TrackFilters } from "@tapry/shared";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { cn } from "@/components/ui";
import { canPreviewFilters, canvasFilter, tintColor } from "@/lib/client/filter-picture";
import { DEFAULT_PREFS, type FilterPrefs } from "@/lib/client/filters";
import { Icon, ICON } from "./icons";

/** Is anything on that changes what this person sends? (The dot on the Filters button.) */
export const filtersOn = (filters: TrackFilters, hasCamera: boolean) => (hasCamera && hasVideoFilters(filters)) || hasAudioFilters(filters);

const BRIGHTNESS: Array<[TrackFilters["brightness"], MessageKey]> = [
  [0, "filters.b0"],
  [1, "filters.b1"],
  [2, "filters.b2"],
];
const BACKGROUND: Array<[TrackFilters["background"], MessageKey]> = [
  ["none", "filters.bg.none"],
  ["blur", "filters.bg.blur"],
];

/** "page": on the app's surface (green room). "stage": on the dark call stage, in both themes. */
type Tone = "page" | "stage";
const TONE = {
  page: {
    panel: "border-border bg-surface text-text",
    muted: "text-muted",
    line: "border-divider",
    group: "bg-surface-2",
    option: "text-text-2 peer-checked:bg-surface peer-checked:text-text peer-checked:shadow-xs",
    swatch: "border-border peer-checked:border-ink",
    off: "bg-border-strong",
    hover: "hover:bg-surface-2",
  },
  stage: {
    panel: "border-white/12 bg-[#232326] text-white shadow-[0_18px_40px_-12px_rgba(0,0,0,.7)]",
    muted: "text-white/60",
    line: "border-white/10",
    group: "bg-white/8",
    option: "text-white/80 peer-checked:bg-white peer-checked:text-[#18181b]",
    swatch: "border-white/15 peer-checked:border-white",
    off: "bg-white/25",
    hover: "hover:bg-white/10",
  },
} as const;

/**
 * Closing behaviour for the Filters panel: Escape closes it (before anything else hears the key,
 * so it doesn't also leave full screen) and gives focus back to the button; a click elsewhere
 * closes it too, when `outside`. Opening moves focus into the panel.
 */
export function useFiltersPanel(outside: boolean) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button, input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    if (outside) window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, outside]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return { open, toggle: () => setOpen((o) => !o), close, button, panel };
}

/**
 * How you look and sound to the others, and in your finished files. The recording itself is
 * never filtered. Without a camera (audio-only studio, or camera off) only noise removal shows.
 */
export function FiltersPanel({
  prefs,
  onChange,
  hasCamera,
  blur,
  tone,
  panelRef,
  onClose,
  id,
  className,
}: {
  prefs: FilterPrefs;
  onChange: (next: FilterPrefs) => void;
  hasCamera: boolean;
  /** Background blur as it stands: getting ready, why it went off by itself, turned on after recording started. */
  blur: { status: "off" | "loading" | "ready"; problem: string | null; late?: boolean };
  tone: Tone;
  panelRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  id?: string;
  className?: string;
}) {
  const { t: tr } = useT();
  const t = TONE[tone];
  const name = useId();
  const { filters, mirror } = prefs;
  const set = (change: Partial<TrackFilters>) => onChange({ ...prefs, filters: { ...filters, ...change } });
  // Asked after mounting: the answer depends on the browser.
  const [canPreview, setCanPreview] = useState(true);
  useEffect(() => setCanPreview(canPreviewFilters()), []);
  const changed = mirror !== DEFAULT_PREFS.mirror || hasVideoFilters(filters) || hasAudioFilters(filters);

  return (
    <div
      ref={panelRef}
      id={id}
      role="group"
      aria-label={tr("filters.title")}
      data-testid="filters-panel"
      className={cn("flex flex-col gap-3.5 rounded-xl border p-3.5 text-sm", t.panel, className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{tr("filters.title")}</span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange(DEFAULT_PREFS)}
            disabled={!changed}
            className={cn("cursor-pointer rounded-md px-1.5 py-0.5 text-[14px] underline underline-offset-[3px] disabled:cursor-default disabled:opacity-40", t.muted)}
          >
            {tr("filters.reset")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr("filters.close")}
            className={cn("grid size-7 cursor-pointer place-items-center rounded-md transition-colors", t.muted, t.hover)}
          >
            <Icon d={ICON.close} className="size-[15px]" />
          </button>
        </span>
      </div>

      {hasCamera && (
        <>
          <Switch tone={tone} label={tr("filters.mirror")} hint={tr("filters.mirrorHint")} checked={mirror} onChange={(v) => onChange({ ...prefs, mirror: v })} />

          <fieldset className="flex flex-col gap-1.5">
            <legend className={cn("mb-1.5 text-[14px]", t.muted)}>{tr("filters.brightness")}</legend>
            <div className={cn("grid grid-cols-3 gap-0.5 rounded-md p-0.5", t.group)}>
              {BRIGHTNESS.map(([value, label]) => (
                <label key={value} className="relative flex cursor-pointer">
                  <input
                    type="radio"
                    name={`${name}-brightness`}
                    className="peer sr-only"
                    checked={filters.brightness === value}
                    onChange={() => set({ brightness: value })}
                  />
                  <span
                    className={cn(
                      "flex min-h-8 flex-1 items-center justify-center rounded-[5px] px-1.5 py-1 text-center text-[14px] leading-tight transition-colors",
                      "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                      t.option,
                    )}
                  >
                    {tr(label)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className={cn("mb-1.5 text-[14px]", t.muted)}>{tr("filters.look")}</legend>
            <div className="grid grid-cols-4 gap-2">
              {LOOKS.map((look) => (
                <label key={look} className="relative flex cursor-pointer flex-col items-center gap-1.5 text-center text-xs leading-tight">
                  <input
                    type="radio"
                    name={`${name}-look`}
                    className="peer sr-only"
                    checked={filters.look === look}
                    onChange={() => set({ look })}
                  />
                  <span
                    className={cn(
                      "relative block aspect-[4/3] w-full overflow-hidden rounded-md border-2 transition-colors",
                      "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                      t.swatch,
                    )}
                  >
                    <LookSwatch look={look} />
                  </span>
                  <span className={cn("peer-checked:font-medium", filters.look !== look && t.muted)}>{tr(`filters.look.${look}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className={cn("mb-1.5 text-[14px]", t.muted)}>{tr("filters.background")}</legend>
            <div className={cn("grid grid-cols-2 gap-0.5 rounded-md p-0.5", t.group)}>
              {BACKGROUND.map(([value, label]) => (
                <label key={value} className="relative flex cursor-pointer">
                  <input
                    type="radio"
                    name={`${name}-background`}
                    className="peer sr-only"
                    checked={filters.background === value}
                    disabled={!canPreview}
                    onChange={() => set({ background: value })}
                  />
                  <span
                    className={cn(
                      "flex min-h-8 flex-1 items-center justify-center rounded-[5px] px-1.5 py-1 text-center text-[14px] leading-tight transition-colors peer-disabled:opacity-50",
                      "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                      t.option,
                    )}
                  >
                    {tr(label)}
                  </span>
                </label>
              ))}
            </div>
            <BlurNote tone={tone} on={filters.background === "blur"} blur={blur} />
          </fieldset>

          <Switch tone={tone} label={tr("filters.touchUp")} hint={tr("filters.touchUpHint")} checked={filters.touchUp} onChange={(touchUp) => set({ touchUp })} />
        </>
      )}

      <Switch
        tone={tone}
        label={tr("filters.noise")}
        hint={tr("filters.noiseHint")}
        checked={filters.noiseRemoval}
        onChange={(noiseRemoval) => set({ noiseRemoval })}
      />

      <p className={cn("border-t pt-3 text-[13.5px] leading-normal text-pretty", t.line, t.muted)}>
        {tr("filters.kept")}
        {hasCamera && !canPreview && (
          <span data-testid="filters-no-preview"> {tr("filters.noPreview")}</span>
        )}
      </p>
    </div>
  );
}

/** Under Background: what blur is doing, or why it isn't. Announced, since it can change by itself. */
function BlurNote({ tone, on, blur }: { tone: Tone; on: boolean; blur: { status: "off" | "loading" | "ready"; problem: string | null; late?: boolean } }) {
  const { t: tr } = useT();
  const text = blur.problem
    ? blur.problem
    : !on
      ? null
      : blur.status !== "ready"
        ? tr("filters.blurLoading")
        : blur.late
          ? tr("filters.blurLate")
          : tr("filters.blurOn");
  return (
    <p
      role="status"
      data-testid="blur-status"
      data-blur={blur.problem ? "problem" : !on ? "off" : blur.status}
      className={cn("mt-1.5 text-[13.5px] leading-snug text-pretty empty:hidden", blur.problem || blur.late ? (tone === "stage" ? "text-[#ffb4a2]" : "text-warn-strong") : TONE[tone].muted)}
    >
      {text}
    </p>
  );
}

/**
 * A look, shown on a fixed patch of colour (skin, sky, leaf, paper) with the same numbers the
 * live picture uses: the CSS filter, and the temperature's tint multiplied over it.
 */
function LookSwatch({ look }: { look: Look }) {
  const f = { ...NO_FILTERS, look };
  const filter = canvasFilter(f);
  const tint = tintColor(f);
  return (
    <span aria-hidden className="absolute inset-0 grid grid-cols-2 grid-rows-2" style={{ filter: filter === "none" ? undefined : filter }}>
      <span className="bg-[#d9a184]" />
      <span className="bg-[#7fa8d9]" />
      <span className="bg-[#7fae7a]" />
      <span className="bg-[#ececec]" />
      {tint && <span className="absolute inset-0 mix-blend-multiply" style={{ background: tint }} />}
    </span>
  );
}

function Switch({
  tone,
  label,
  hint,
  checked,
  onChange,
}: {
  tone: Tone;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = TONE[tone];
  const hintId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={hintId}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md text-left"
    >
      <span className="flex min-w-0 flex-col gap-px">
        <span className="font-medium">{label}</span>
        <span id={hintId} className={cn("text-[13.5px] leading-snug", t.muted)}>
          {hint}
        </span>
      </span>
      <span aria-hidden className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : t.off)}>
        <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-xs transition-transform", checked && "translate-x-4")} />
      </span>
    </button>
  );
}
