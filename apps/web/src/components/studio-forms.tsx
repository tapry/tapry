"use client";

// Host-side forms around a studio (a "studio" in the API): invite link, settings, enter,
// delete, and logging out. Creating a studio has its own page (new-studio-form.tsx).
import { SELECTED_CARD, UNSELECTED_CARD } from "./quality-options";
import { qualityOptions, type QualityChoice } from "./quality-options";
import { defaultConsentText, type SessionTicket, type StudioSettings, FRAME_RATES, type FrameRate } from "@tapry/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { apiFetch, ApiRequestError, saveTicket } from "@/lib/client/api";
import { ConfirmAction } from "./confirm-action";
import { Icon, ListCard, Spinner } from "./ui-extra";
import { Button, cn, Input, Notice, Select, Textarea } from "./ui";

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
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
        <span className="text-[14px] text-muted">Guest link · anyone with it can join from a browser, once you&apos;ve entered the studio</span>
        <span className="flex flex-wrap gap-1.5">
          <input
            readOnly
            value={link}
            aria-label="Guest invite link"
            onFocus={(e) => e.currentTarget.select()}
            className="h-9 min-w-48 flex-1 truncate rounded-md bg-surface-2 px-[11px] text-sm text-text-2 focus:outline-none"
          />
          <Button size="sm" onClick={() => copy("invite")}>
            <Icon name={copied === "invite" ? "check" : "copy"} size={15} />
            {copied === "invite" ? "Copied" : "Copy link"}
          </Button>
          <Button variant="secondary" size="sm" onClick={rotate}>
            Make a new link
          </Button>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">Tech-check link</span>
          <span className="text-[14px] text-muted">Before the session, guests can test their camera, mic and connection.</span>
          <input
            readOnly
            value={checkLink}
            aria-label="Tech-check link"
            onFocus={(e) => e.currentTarget.select()}
            className="mt-1 min-w-0 truncate bg-transparent font-mono text-[13px] text-muted focus:outline-none"
          />
        </span>
        <button
          type="button"
          onClick={() => copy("check")}
          className="cursor-pointer rounded-md border border-border bg-surface px-3 py-[7px] text-[14px] font-medium whitespace-nowrap text-text transition-colors hover:border-ink"
        >
          {copied === "check" ? "✓ Copied" : "Copy tech-check link"}
        </button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

export function StudioSettingsForm({
  studioId,
  name,
  settings,
  hostName,
  section,
  can4k = true,
}: {
  studioId: string;
  name: string;
  settings: StudioSettings;
  hostName: string;
  /** This account's studios may record in 4K (its plan, on Tapry Cloud; always on a self-hosted server). */
  can4k?: boolean;
  /**
   * Show only part of the form (the Settings page's Recording and Guests tabs). The rest stays in
   * the form, hidden, so saving always sends every setting as it is.
   */
  section?: "recording" | "guests";
}) {
  const router = useRouter();
  const [quality, setQuality] = useState<QualityChoice>(settings.audioOnly ? "audio" : settings.videoQuality);
  const [guests, setGuests] = useState(settings.maxGuests);
  const [status, setStatus] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch(`/studios/${studioId}`, {
        method: "PATCH",
        body: {
          // On the Guests tab the name field is hidden: an emptied one there keeps the saved name.
          name: section === "guests" && !String(f.get("name") ?? "").trim() ? name : f.get("name"),
          settings: {
            // Audio only keeps the video quality as it was, for switching back.
            videoQuality: quality === "audio" ? settings.videoQuality : quality,
            audioOnly: quality === "audio",
            maxGuests: guests,
            echoCancellation: f.get("echoCancellation") === "on",
            levelLoudness: f.get("levelLoudness") === "on",
            guestDownloads: f.get("guestDownloads") === "on",
            consentText: String(f.get("consentText") ?? ""),
            audioFormat: f.get("audioFormat") === "flac" ? "flac" : "wav",
            deleteAfterDays: Number(f.get("deleteAfterDays")) > 0 ? Number(f.get("deleteAfterDays")) : null,
            frameRate: (FRAME_RATES as readonly string[]).includes(String(f.get("frameRate"))) ? (String(f.get("frameRate")) as FrameRate) : settings.frameRate,
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
    <form onSubmit={submit} className="flex flex-col gap-5">
      <ListCard>
        <div className={section === "guests" ? "hidden" : "contents"}>
          <SectionLabel>Studio</SectionLabel>
          <Row label={<label htmlFor="studio-name">Studio name</label>} help="Guests see this on their invite.">
            <Input id="studio-name" name="name" defaultValue={name} required={section !== "guests"} maxLength={100} className="sm:w-[280px]" />
          </Row>

          <SectionLabel>Recording</SectionLabel>
          <fieldset className="flex flex-col gap-3 border-b border-divider py-4">
            <legend className="sr-only">Recording</legend>
            <span className="flex flex-col gap-[3px]">
              <span className="font-medium">Video quality</span>
              <span className="text-[14px] leading-normal text-muted">Each person is recorded on their own device at this quality.</span>
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {qualityOptions(can4k).map(([value, label, sub, locked]) => (
                <label
                  key={value}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-lg border bg-surface px-2.5 py-2 transition-[border-color,box-shadow]",
                    locked && quality !== value ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                    quality === value ? SELECTED_CARD : UNSELECTED_CARD,
                  )}
                >
                  <input
                    type="radio"
                    name="videoQuality"
                    value={value}
                    checked={quality === value}
                    disabled={locked && quality !== value}
                    onChange={() => setQuality(value)}
                    className="sr-only"
                  />
                  <span className="font-medium">{label}</span>
                  <span className="text-[13.5px] text-muted">{sub}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Row label={<span id="guests-label">Number of guests</span>} help="Not counting you.">
            <Stepper value={guests} min={1} max={7} onChange={setGuests} labelledBy="guests-label" />
          </Row>
          <SwitchRow
            name="echoCancellation"
            defaultChecked={settings.echoCancellation}
            label="Reduce echo for guests without headphones"
            help="It switches off automatically for guests wearing headphones, because they sound better without it."
          />
          <SwitchRow
            name="levelLoudness"
            defaultChecked={settings.levelLoudness}
            label="Even out everyone's volume"
            help="Quiet guests are brought up to the same level as everyone else (−16 LUFS, a common level for spoken audio). Only the volume changes, never how anyone sounds. Applies to recordings processed from now on."
          />
          <Row
            label={<label htmlFor="audio-format">Audio files</label>}
            help="For each person's audio. FLAC is the same sound at about half the size; a few older editors only open WAV. Applies to recordings processed from now on."
          >
            <Select id="audio-format" name="audioFormat" defaultValue={settings.audioFormat} className="sm:w-[280px]">
              <option value="wav">WAV (opens anywhere)</option>
              <option value="flac">FLAC (lossless, about half the size)</option>
            </Select>
          </Row>
          <Row
            label={<label htmlFor="frame-rate">Frames a second</label>}
            help="Of the video files. 30 suits the web; choose 25, 24 or 29.97 to match the timeline you edit in. Applies to recordings processed from now on."
          >
            <Select id="frame-rate" name="frameRate" defaultValue={settings.frameRate} className="sm:w-[280px]">
              <option value="30">30</option>
              <option value="29.97">29.97 (NTSC)</option>
              <option value="25">25 (PAL)</option>
              <option value="24">24 (film)</option>
            </Select>
          </Row>
          <Row
            label={<label htmlFor="delete-after">Delete recordings</label>}
            help="Each recording is deleted, files and all, this long after its files are ready. For studios that must not keep recordings longer than a set time. Applies to recordings processed from now on."
          >
            <Select id="delete-after" name="deleteAfterDays" defaultValue={String(settings.deleteAfterDays ?? 0)} className="sm:w-[280px]">
              <option value="0">Never (until you delete them)</option>
              <option value="7">After 7 days</option>
              <option value="30">After 30 days</option>
              <option value="90">After 90 days</option>
              <option value="180">After 180 days</option>
              <option value="365">After a year</option>
              {settings.deleteAfterDays && ![7, 30, 90, 180, 365].includes(settings.deleteAfterDays) && <option value={settings.deleteAfterDays}>After {settings.deleteAfterDays} days</option>}
            </Select>
          </Row>
        </div>
        <div className={section === "recording" ? "hidden" : "contents"}>
          <SectionLabel>Guests</SectionLabel>
          <div className="flex flex-col gap-3 border-b border-divider py-4">
            <span className="flex flex-col gap-[3px]">
              <label htmlFor="consent-text" className="font-medium">
                What guests agree to
              </label>
              <span className="text-[14px] leading-normal text-pretty text-muted">
                Shown next to the consent box on the invite; guests must tick it to join. Leave it empty for the text shown here. Each
                guest&apos;s agreement is kept with the exact text and when they agreed (the recording&apos;s consent record). A change
                applies to guests who join from now on.
              </span>
            </span>
            <Textarea
              id="consent-text"
              name="consentText"
              defaultValue={settings.consentText}
              maxLength={4000}
              rows={4}
              placeholder={defaultConsentText(hostName, quality === "audio")}
            />
          </div>
          <SwitchRow
            name="guestDownloads"
            defaultChecked={settings.guestDownloads}
            label="Guests can download their own recording"
            help="Once a recording is ready, each guest can download their own audio (and video) from the page they recorded on. Only their own, never anyone else's."
            last
          />
        </div>
      </ListCard>
      <div className="flex items-center gap-3.5">
        <Button type="submit">Save changes</Button>
        {status && <span className={cn("text-sm", status.tone === "ok" ? "text-ok-strong" : "text-danger")}>{status.text}</span>}
      </div>
    </form>
  );
}

/** A small grey heading inside a settings card ("Recording", "Guests"). */
function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="border-b border-border pt-3 pb-2 text-[14px] text-muted">{children}</span>;
}

/** A settings row: what it is and why on the left, the control on the right. */
function Row({ label, help, children, last }: { label: ReactNode; help?: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4", !last && "border-b border-divider")}>
      <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
        <span className="font-medium">{label}</span>
        {help && <span className="text-[14px] leading-normal text-pretty text-muted">{help}</span>}
      </span>
      <span className="flex w-full shrink-0 sm:w-auto">{children}</span>
    </div>
  );
}

/**
 * A checkbox drawn as the designs' switch, in a settings row. The whole row is its label.
 * The knob is the surface colour, not white: in the dark theme the "on" track is near-white.
 */
function SwitchRow({
  label,
  help,
  last,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; help: string; last?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-x-6 gap-y-3 py-4", !last && "border-b border-divider")}>
      <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
        <span className="font-medium">{label}</span>
        <span className="text-[14px] leading-normal text-pretty text-muted">{help}</span>
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" {...props} />
      <span
        aria-hidden
        className="relative h-5 w-9 shrink-0 rounded-full bg-subtle transition-colors duration-[250ms] peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-checked:[&>span]:left-[18px]"
      >
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-surface shadow-xs transition-[left] duration-[250ms] ease-[cubic-bezier(.2,.7,.2,1)]" />
      </span>
    </label>
  );
}

/** − n + in a pill, for counts like guests per recording. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  labelledBy,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  labelledBy: string;
}) {
  const btn =
    "grid size-9 cursor-pointer place-items-center text-base text-text transition-colors hover:bg-surface-2 disabled:cursor-default disabled:text-border-strong disabled:hover:bg-transparent";
  return (
    <span className="flex items-center overflow-hidden rounded-md border border-border bg-surface shadow-xs" role="group" aria-labelledby={labelledBy}>
      <button type="button" aria-label="Fewer guests" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className={btn}>
        −
      </button>
      <span className="w-8 text-center font-medium tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" aria-label="More guests" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className={btn}>
        +
      </button>
    </span>
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
      <Button variant="record" size="sm" onClick={open} disabled={busy}>
        {busy ? <Spinner size={15} /> : <span aria-hidden className={cn("size-2 rounded-full bg-current", live && "animate-rec-pulse")} />}
        {live ? "Back to the live studio" : "Enter studio"}
      </Button>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

export function DeleteStudioButton({ studioId, name, recordings }: { studioId: string; name: string; recordings: number }) {
  const router = useRouter();
  return (
    <ConfirmAction
      label="Delete studio…"
      trigger="button"
      testId="delete-studio"
      question={
        <>
          Delete “{name}”
          {recordings > 0 && ` and its ${recordings} recording${recordings === 1 ? "" : "s"}`}? Guests in it are disconnected and
          the files are removed from the server. This can&apos;t be undone.
        </>
      }
      confirmLabel="Delete studio"
      action={async () => {
        await apiFetch(`/studios/${studioId}`, { method: "DELETE" });
        router.replace("/studios");
        router.refresh();
      }}
    />
  );
}

/** The sidebar's log-out icon, next to the account. */
export function LogOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Log out"
      title="Log out"
      className="ml-auto grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text"
      onClick={async () => {
        await apiFetch("/auth/logout", { body: {} }).catch(() => {});
        router.replace("/login");
        router.refresh();
      }}
    >
      <Icon name="logout" size={15} />
    </button>
  );
}
