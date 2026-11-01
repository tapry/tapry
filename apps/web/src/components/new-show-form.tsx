"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Avatar, CheckboxRow, cn, Notice } from "./ui";

const MAX_NAME = 100;
const MAX_GUESTS = 7;
// Guests in the seat preview get calm placeholder colors; the host shows their initials.
const SEAT_COLORS = ["#fbd5cc", "#f4b6a3", "#d98a9c", "#c9b8e4", "#ffe3d6", "#e7c2cf", "#b9a6d6"];

/** The "New show" screen: a name, how many guests, video quality and sound options. */
export function NewShowForm({ hostName, firstShow }: { hostName: string; firstShow: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [guests, setGuests] = useState(3);
  const [quality, setQuality] = useState<"1080p" | "720p">("1080p");
  const [echo, setEcho] = useState(true);
  const [level, setLevel] = useState(true);
  const [soundOpen, setSoundOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const show = await apiFetch<{ id: string }>("/studios", {
        body: {
          name: name.trim(),
          settings: { maxGuests: guests, videoQuality: quality, echoCancellation: echo, levelLoudness: level },
        },
      });
      router.push(`/shows/${show.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full max-w-[620px] flex-col gap-5">
      {!firstShow && (
        <Link href="/shows" className="self-start text-sm text-muted hover:text-text">
          ← Your shows
        </Link>
      )}
      <form
        onSubmit={submit}
        className="overflow-hidden rounded-3xl bg-surface shadow-[0_30px_60px_-36px_rgba(60,20,30,.35),0_0_0_1px_var(--border)]"
      >
        <div className="flex flex-col gap-[22px] px-[clamp(20px,4vw,40px)] pt-[clamp(24px,4vw,40px)] pb-7">
          <div className="flex items-center gap-3.5">
            <span aria-hidden className="grid size-[52px] shrink-0 place-items-center rounded-[14px] bg-accent-soft text-[22px] font-bold text-accent">
              {(name.trim()[0] ?? "+").toUpperCase()}
            </span>
            <span className="flex flex-col gap-0.5">
              <h1 className="text-[clamp(26px,3vw,32px)] leading-[1.1] font-bold tracking-[-.03em]">
                {firstShow ? "Your first show" : "New show"}
              </h1>
              <span className="text-[15px] text-muted">Where your episodes and guests live.</span>
            </span>
          </div>

          <label className="flex flex-col gap-2 text-[15px] font-medium">
            What&apos;s it called?
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME}
              required
              autoFocus
              placeholder="e.g. The Long Table"
              className={cn(
                "h-[60px] rounded-[14px] border-2 bg-surface px-[18px] text-xl font-medium tracking-[-.01em] outline-none transition-colors placeholder:text-subtle",
                ready ? "border-accent" : "border-border-strong focus:border-accent",
              )}
            />
            <span className="flex justify-between gap-3 text-[13px] font-normal text-subtle">
              <span>Guests see this on their invite. You can rename it anytime.</span>
              <span className="tabular-nums">
                {name.length} / {MAX_NAME}
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="flex flex-col gap-[3px]">
              <span className="text-[15px] font-medium" id="guests-label">
                Guests per episode
              </span>
              <span className="text-sm text-muted">
                You + {guests} guest{guests === 1 ? "" : "s"}, up to {MAX_GUESTS}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span aria-hidden className="flex pl-2">
                <Avatar name={hostName} className="-ml-2 size-[30px] border-2 border-surface text-[10px]" />
                {Array.from({ length: guests }, (_, i) => (
                  <span key={i} className="-ml-2 size-[30px] rounded-full border-2 border-surface" style={{ background: SEAT_COLORS[i] }} />
                ))}
              </span>
              <span className="flex items-center overflow-hidden rounded-full border border-border-strong" role="group" aria-labelledby="guests-label">
                <button
                  type="button"
                  aria-label="Fewer guests"
                  disabled={guests <= 1}
                  onClick={() => setGuests(Math.max(1, guests - 1))}
                  className="size-11 cursor-pointer text-lg font-semibold disabled:cursor-default disabled:text-border-strong"
                >
                  −
                </button>
                <span className="w-7 text-center text-base font-semibold tabular-nums" aria-live="polite">
                  {guests}
                </span>
                <button
                  type="button"
                  aria-label="More guests"
                  disabled={guests >= MAX_GUESTS}
                  onClick={() => setGuests(Math.min(MAX_GUESTS, guests + 1))}
                  className="size-11 cursor-pointer text-lg font-semibold disabled:cursor-default disabled:text-border-strong"
                >
                  +
                </button>
              </span>
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="flex flex-col gap-[3px]">
              <span className="text-[15px] font-medium" id="quality-label">
                Video quality
              </span>
              <span className="text-sm text-muted">{quality === "1080p" ? "Best quality, larger files" : "Smaller files, still sharp"}</span>
            </span>
            <span className="flex gap-1 rounded-xl bg-[#f2f1ef] p-1 dark:bg-surface-2" role="radiogroup" aria-labelledby="quality-label">
              {(
                [
                  ["1080p", "Full HD"],
                  ["720p", "Standard"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={quality === value}
                  onClick={() => setQuality(value)}
                  className={cn(
                    "cursor-pointer rounded-[9px] px-4 py-[9px] text-sm font-medium whitespace-nowrap",
                    quality === value ? "bg-surface text-text shadow-[0_1px_3px_rgba(0,0,0,.1)]" : "text-muted",
                  )}
                >
                  {label}
                </button>
              ))}
            </span>
          </div>

          <div className="flex flex-col border-t border-border pt-1.5">
            <button
              type="button"
              aria-expanded={soundOpen}
              onClick={() => setSoundOpen(!soundOpen)}
              className="flex cursor-pointer items-center justify-between py-3 text-left text-[15px] font-medium"
            >
              Sound options
              <span className="text-[13px] font-normal text-subtle">
                {soundOpen ? "Hide" : [echo && "Echo reduction", level && "Even volume"].filter(Boolean).join(" · ") || "Off"}
              </span>
            </button>
            {soundOpen && (
              <div className="flex flex-col gap-1 pb-1">
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

        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-border bg-[#faf9f7] px-[clamp(20px,4vw,40px)] py-[18px] dark:bg-surface-2">
          {!firstShow && (
            <Link href="/shows" className="flex h-[50px] items-center rounded-xl px-[18px] text-base font-medium text-text-2 hover:text-text">
              Cancel
            </Link>
          )}
          <button
            type="submit"
            aria-disabled={!ready}
            className={cn(
              "h-[50px] rounded-xl px-[26px] text-base font-semibold whitespace-nowrap text-white transition-colors",
              ready ? "cursor-pointer bg-accent hover:bg-accent-hover" : "cursor-not-allowed bg-[#e2c3bb] dark:bg-accent-line",
            )}
          >
            {busy ? "Creating…" : "Create show"}
          </button>
        </div>
      </form>
      <p className="text-center text-sm text-subtle">Next, you&apos;ll get a guest link to share. Nothing records until you press Record.</p>
    </div>
  );
}
