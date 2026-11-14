"use client";

import { SELECTED_CARD, UNSELECTED_CARD } from "./quality-options";
import { qualityOptions, type QualityChoice } from "./quality-options";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { STUDIO_TEMPLATES, templateConsent, type StudioTemplate } from "@/lib/studio-templates";
import { Stepper } from "./studio-forms";
import { Icon, Spinner } from "./ui-extra";
import { Avatar, CheckboxRow, cn, Logo, Notice } from "./ui";

const MAX_NAME = 100;
const MAX_GUESTS = 7;

/** The "New studio" screen: a name, how many guests, video quality and sound options. */
export function NewStudioForm({ hostName, firstStudio, can4k = true }: { hostName: string; firstStudio: boolean; /** This account may record in 4K. */ can4k?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [guests, setGuests] = useState(3);
  const [quality, setQuality] = useState<QualityChoice>("1080p");
  const [echo, setEcho] = useState(true);
  const [level, setLevel] = useState(true);
  const [soundOpen, setSoundOpen] = useState(false);
  const [template, setTemplate] = useState<StudioTemplate>(STUDIO_TEMPLATES[0]!);
  /** A template fills the form in; what it set can still be changed below. */
  function pick(t: StudioTemplate) {
    setTemplate(t);
    setGuests(t.guests);
    setQuality(t.quality);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const studio = await apiFetch<{ id: string }>("/studios", {
        body: {
          name: name.trim(),
          settings: {
            maxGuests: guests,
            videoQuality: quality === "audio" ? "1080p" : quality,
            audioOnly: quality === "audio",
            echoCancellation: echo,
            levelLoudness: level,
            ...template.settings,
            ...(template.consent ? { consentText: templateConsent(template, hostName) } : {}),
          },
        },
      });
      // The template's guide. The studio exists either way: a failure here isn't worth stopping for.
      if (template.guide) await apiFetch(`/studios/${studio.id}/guide`, { method: "PUT", body: { guide: template.guide } }).catch(() => {});
      if (template.solo) await apiFetch(`/studios/${studio.id}/solo`, { method: "PUT", body: { enabled: true, prompt: template.solo } }).catch(() => {});
      router.push(`/studios/${studio.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4">
      <form onSubmit={submit} className="ember-card flex animate-fade-up flex-col gap-[22px] rounded-[19px] bg-canvas p-[clamp(22px,5vw,36px)] text-text">
        <div className="flex items-center justify-between gap-3">
          <Link href="/studios" aria-label="Tapry home" className="text-text hover:text-text">
            <Logo className="text-[16px]" mark="size-6" />
          </Link>
          {!firstStudio && (
            <Link href="/studios" className="flex items-center gap-1.5 text-[14px] text-muted hover:text-text">
              <Icon name="back" size={14} />
              Your studios
            </Link>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[27px] leading-tight font-semibold tracking-[-.025em]">{firstStudio ? "Your first studio" : "New studio"}</h1>
            <p className="text-[15.5px] leading-normal text-muted">Where your recordings and guests live. You can add more studios later.</p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">What&apos;s it called?</span>
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME}
              required
              autoFocus
              placeholder="e.g. The Long Table"
              className="h-10 rounded-md border border-border bg-surface px-3 text-[16px] text-text shadow-xs transition-[border-color,box-shadow] outline-none placeholder:text-subtle focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)]"
            />
            <span className="flex justify-between gap-3 text-[13.5px] text-muted">
              <span>Guests see this on their invite. You can rename it anytime.</span>
              <span className="tabular-nums">
                {name.length} / {MAX_NAME}
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium" id="template-label">
              Start from
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="template-label" data-testid="templates">
              {STUDIO_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={template.id === t.id}
                  onClick={() => pick(t)}
                  className={cn(
                    "flex cursor-pointer flex-col gap-0.5 rounded-lg border bg-surface px-2.5 py-2 text-left text-text transition-[border-color,box-shadow] duration-200",
                    template.id === t.id ? SELECTED_CARD : UNSELECTED_CARD,
                  )}
                >
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="text-[13.5px] text-muted">{t.about}</span>
                </button>
              ))}
            </div>
            {template.id !== "blank" && (
              <span className="text-[13.5px] leading-normal text-pretty text-muted" data-testid="template-note">
                Sets the options below{template.consent ? ", the consent text guests agree to" : ""} and a guide to follow in the session.
                {template.solo ? " Its solo link is switched on with an assignment to edit: share it, and each student's recording arrives in this studio. Recordings are deleted after 120 days." : ""} All of it can be changed in the studio&apos;s settings.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium" id="quality-label">
              Recording
            </span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="quality-label">
              {qualityOptions(can4k).map(([value, label, sub, locked]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={quality === value}
                  disabled={locked}
                  onClick={() => setQuality(value)}
                  className={cn(
                    "flex cursor-pointer flex-col disabled:cursor-not-allowed disabled:opacity-60 gap-0.5 rounded-lg border bg-surface px-2.5 py-2 text-left text-text transition-[border-color,box-shadow] duration-200",
                    quality === value ? SELECTED_CARD : UNSELECTED_CARD,
                  )}
                >
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-[13.5px] text-muted">{sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="flex flex-col gap-[3px]">
              <span className="text-sm font-medium" id="guests-label">
                Guests per recording
              </span>
              <span className="text-[14px] text-muted">
                You + {guests} guest{guests === 1 ? "" : "s"}, up to {MAX_GUESTS}
              </span>
            </span>
            <span className="flex items-center gap-3">
              {/* One seat each: you, then a place for every guest. Decorative: the words beside it say the same. */}
              <span aria-hidden className="flex flex-wrap items-center gap-1.5" data-testid="seats">
                <Avatar name={hostName} className="size-7 text-[11.5px]" />
                {Array.from({ length: guests }, (_, i) => (
                  <span key={i} className="grid size-7 place-items-center rounded-full border border-dashed border-border-strong bg-surface text-subtle">
                    <svg viewBox="0 0 24 24" className="size-[13px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8a4 4 0 0 0 0-8z" />
                    </svg>
                  </span>
                ))}
              </span>
              <Stepper value={guests} min={1} max={MAX_GUESTS} onChange={setGuests} labelledBy="guests-label" />
            </span>
          </div>

          <div className="flex flex-col rounded-lg border border-border bg-surface px-3.5">
            <button
              type="button"
              aria-expanded={soundOpen}
              onClick={() => setSoundOpen(!soundOpen)}
              className="flex cursor-pointer items-center justify-between gap-3 py-3 text-left text-sm font-medium"
            >
              Sound options
              <span className="flex items-center gap-1.5 text-[14px] font-normal text-muted">
                {soundOpen ? "Hide" : [echo && "Echo reduction", level && "Even volume"].filter(Boolean).join(" · ") || "Off"}
                <Icon name="back" size={13} className={cn("transition-transform", soundOpen ? "rotate-90" : "-rotate-90")} />
              </span>
            </button>
            {soundOpen && (
              <div className="flex animate-fade-up flex-col gap-1 border-t border-divider pt-1 pb-2">
                <CheckboxRow
                  className="py-2.5"
                  checked={echo}
                  onChange={(e) => setEcho(e.target.checked)}
                  label="Reduce echo for guests without headphones"
                  description="Switches off automatically for guests wearing headphones, because they sound better without it."
                />
                <CheckboxRow
                  className="py-2.5"
                  checked={level}
                  onChange={(e) => setLevel(e.target.checked)}
                  label="Even out everyone's volume"
                  description="Quiet guests are brought up to the same level as everyone else. Only the volume changes, never how anyone sounds."
                />
              </div>
            )}
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-[18px]">
          {!firstStudio ? (
            <Link
              href="/studios"
              className="flex h-[38px] items-center rounded-md border border-border bg-surface px-3.5 text-sm font-medium text-text transition-colors hover:bg-surface-2 hover:text-text"
            >
              Cancel
            </Link>
          ) : (
            <span className="text-[14px] text-muted">Next: a guest link to share. Nothing records until you press Record.</span>
          )}
          {!firstStudio && <span className="text-[14px] text-muted">Nothing records until you press Record.</span>}
          <button
            type="submit"
            aria-disabled={!ready}
            className={cn(
              "ml-auto flex h-[38px] items-center gap-2 rounded-md px-4 text-sm font-medium whitespace-nowrap transition-colors",
              ready ? "cursor-pointer bg-ink text-ink-text hover:bg-ink-hover" : "cursor-not-allowed bg-ink text-ink-text opacity-50",
            )}
          >
            {busy && <Spinner size={15} />}
            {busy ? "Creating…" : "Create studio"}
          </button>
        </div>
      </form>
    </div>
  );
}
