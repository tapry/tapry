"use client";

// Host-side forms around a show (a "studio" in the API): invite link, settings, enter,
// delete, and logging out. Creating a show has its own page (new-show-form.tsx).
import type { SessionTicket, StudioSettings } from "@tapry/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, ApiRequestError, saveTicket } from "@/lib/client/api";
import { ConfirmAction } from "./confirm-action";
import { Button, CheckboxRow, cn, Field, Input, Notice, RecDot } from "./ui";

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");

export function InviteLink({ studioId, inviteCode: initial }: { studioId: string; inviteCode: string }) {
  const [code, setCode] = useState(initial);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"invite" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const link = `${origin}/join/${code}`;
  const checkLink = `${link}/check`;

  async function copy(which: "invite" | "check") {
    try {
      await navigator.clipboard.writeText(which === "invite" ? link : checkLink);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  async function rotate() {
    if (!confirm("Make a new link? The old link will stop working for anyone who hasn't joined yet.")) return;
    try {
      setCode((await apiFetch<{ inviteCode: string }>(`/studios/${studioId}/invite`, { body: {} })).inviteCode);
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          readOnly
          value={link}
          aria-label="Guest invite link"
          onFocus={(e) => e.currentTarget.select()}
          className="h-12 min-w-60 flex-1 truncate rounded-full border border-dashed border-border-strong bg-transparent px-5 font-mono text-sm text-text-2 focus:outline-none"
        />
        <Button onClick={() => copy("invite")} className="h-12 px-[22px]">
          {copied === "invite" ? "✓ Copied" : "Copy link"}
        </Button>
        <Button variant="secondary" onClick={rotate} className="h-12 px-5 font-medium">
          Make a new link
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
        <span>Before the session, guests can test their setup:</span>
        <input
          readOnly
          value={checkLink}
          aria-label="Tech-check link"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent font-mono text-[13px] text-text-2 focus:outline-none"
        />
        <button type="button" onClick={() => copy("check")} className="cursor-pointer font-medium text-text underline-offset-2 hover:underline">
          {copied === "check" ? "✓ Copied" : "Copy tech-check link"}
        </button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

export function ShowSettingsForm({ studioId, name, settings }: { studioId: string; name: string; settings: StudioSettings }) {
  const router = useRouter();
  const [quality, setQuality] = useState<StudioSettings["videoQuality"] | "audio">(settings.audioOnly ? "audio" : settings.videoQuality);
  const [guests, setGuests] = useState(settings.maxGuests);
  const [status, setStatus] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch(`/studios/${studioId}`, {
        method: "PATCH",
        body: {
          name: f.get("name"),
          settings: {
            // Audio only keeps the video quality as it was, for switching back.
            videoQuality: quality === "audio" ? settings.videoQuality : quality,
            audioOnly: quality === "audio",
            maxGuests: guests,
            echoCancellation: f.get("echoCancellation") === "on",
            levelLoudness: f.get("levelLoudness") === "on",
          },
        },
      });
      setStatus({ tone: "ok", text: "✓ Saved" });
      setTimeout(() => setStatus(null), 2500);
      router.refresh();
    } catch (err) {
      setStatus({ tone: "danger", text: message(err) });
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Field label="Show name">
        <Input name="name" defaultValue={name} required maxLength={100} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[15px] font-medium">Recording</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ["1080p", "Full HD", "Best quality, larger files"],
              ["720p", "Standard", "Smaller files, still sharp"],
              ["audio", "Audio only", "Sound only, no cameras"],
            ] as const
          ).map(([value, label, sub]) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer flex-col gap-[3px] rounded-[10px] border px-4 py-3.5 text-[15px] font-semibold",
                quality === value ? "border-accent bg-accent-soft" : "border-border-strong",
              )}
            >
              <input
                type="radio"
                name="videoQuality"
                value={value}
                checked={quality === value}
                onChange={() => setQuality(value)}
                className="sr-only"
              />
              {label}
              <span className="text-[13px] font-normal text-muted">{sub}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-4 text-[15px]">
        <span className="flex flex-col gap-[3px]">
          <span className="font-medium" id="guests-label">
            Number of guests
          </span>
          <span className="text-sm text-muted">Not counting you</span>
        </span>
        <div className="flex items-center overflow-hidden rounded-full border border-border-strong" role="group" aria-labelledby="guests-label">
          <button
            type="button"
            aria-label="Fewer guests"
            onClick={() => setGuests(Math.max(1, guests - 1))}
            className="size-11 cursor-pointer text-lg font-semibold"
          >
            −
          </button>
          <span className="w-9 text-center font-semibold" aria-live="polite">
            {guests}
          </span>
          <button
            type="button"
            aria-label="More guests"
            onClick={() => setGuests(Math.min(7, guests + 1))}
            className="size-11 cursor-pointer text-lg font-semibold"
          >
            +
          </button>
        </div>
      </div>
      <CheckboxRow
        name="echoCancellation"
        defaultChecked={settings.echoCancellation}
        label="Reduce echo for guests without headphones"
        description="It switches off automatically for guests wearing headphones, because they sound better without it."
      />
      <CheckboxRow
        name="levelLoudness"
        defaultChecked={settings.levelLoudness}
        label="Even out everyone's volume"
        description="Quiet guests are brought up to the same level as everyone else (−16 LUFS, podcast loudness). Only the volume changes, never how anyone sounds. Applies to episodes processed from now on."
      />
      <div className="flex items-center gap-3.5">
        <Button type="submit">Save changes</Button>
        {status && <span className={cn("text-[15px]", status.tone === "ok" ? "text-ok" : "text-danger")}>{status.text}</span>}
      </div>
    </form>
  );
}

export function OpenStudioButton({ studioId, live = false }: { studioId: string; live?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const ticket = await apiFetch<SessionTicket>(`/studios/${studioId}/open`, { body: {} });
      saveTicket(ticket);
      router.push(`/session/${ticket.sessionId}`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="record" size="lg" onClick={open} disabled={busy}>
        <RecDot />
        {live ? "Back to the live studio" : "Enter studio"}
      </Button>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

export function DeleteShowButton({ studioId, name, episodes }: { studioId: string; name: string; episodes: number }) {
  const router = useRouter();
  return (
    <ConfirmAction
      label="Delete show…"
      trigger="button"
      testId="delete-studio"
      question={
        <>
          Delete “{name}”
          {episodes > 0 && ` and its ${episodes} episode${episodes === 1 ? "" : "s"}`}? Guests in it are disconnected and
          the files are removed from the server. This can&apos;t be undone.
        </>
      }
      confirmLabel="Delete show"
      action={async () => {
        await apiFetch(`/studios/${studioId}`, { method: "DELETE" });
        router.replace("/shows");
        router.refresh();
      }}
    />
  );
}

export function LogOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      className="h-9 px-4 text-sm font-medium"
      onClick={async () => {
        await apiFetch("/auth/logout", { body: {} }).catch(() => {});
        router.replace("/login");
        router.refresh();
      }}
    >
      Log out
    </Button>
  );
}
