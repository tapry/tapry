"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { formatBytes, formatClock } from "@/lib/format";
import type { RecordingSummary } from "@/server/processing";
import type { Studio, TechCheck } from "@/server/studios";
import { EpisodeList, settled } from "./episode-list";
import { DeleteShowButton, InviteLink, OpenStudioButton, ShowSettingsForm } from "./studio-forms";
import { Card, cn, Eyebrow } from "./ui";

type Tab = "episodes" | "settings" | "space";

/** One show: its header, numbers, and the Episodes / Settings / Space used tabs. */
export function ShowView({
  show,
  episodes: initial,
  checks,
  shows,
}: {
  show: Studio;
  episodes: RecordingSummary[];
  checks: TechCheck[];
  shows: Array<{ id: string; name: string; bytes: number }>;
}) {
  const [tab, setTab] = useState<Tab>("episodes");
  const [episodes, setEpisodes] = useState(initial);
  useEffect(() => setEpisodes(initial), [initial]);
  const now = useNow(episodes.some((e) => e.status === "recording") ? 1000 : null);

  // Keep the list fresh while anything is recording, uploading or processing.
  const inFlight = episodes.some((e) => !settled(e));
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(async () => {
      try {
        setEpisodes((await apiFetch<{ recordings: RecordingSummary[] }>(`/studios/${show.id}/recordings`)).recordings);
      } catch {
        // Keep showing the last known state; the next poll retries.
      }
    }, 3000);
    return () => clearInterval(id);
  }, [show.id, inFlight]);

  const live = episodes.find((e) => e.status === "recording");
  const ready = episodes.filter((e) => e.processing === "ready").length;
  const recordedMs = episodes.reduce((n, e) => n + ((e.stoppedAt ?? now) - e.startedAt), 0);
  const bytes = episodes.reduce((n, e) => n + e.bytes, 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-2">
          <Eyebrow>Show</Eyebrow>
          <h1 className="text-[clamp(30px,3.4vw,42px)] leading-[1.05] font-medium tracking-[-.02em]">{show.name}</h1>
          <span className="text-[15px] text-pretty text-muted">
            {show.settings.audioOnly ? "Audio only" : show.settings.videoQuality === "1080p" ? "Full HD video" : "Standard video"} · up to {show.settings.maxGuests}{" "}
            guest{show.settings.maxGuests === 1 ? "" : "s"} · started{" "}
            {new Date(show.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>
        <OpenStudioButton studioId={show.id} live={!!live} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,135px),1fr))] gap-3">
        <Stat label="Episodes" value={String(episodes.length)} sub={`${ready} ready to download`} />
        <Stat label="Time recorded" value={`${(recordedMs / 3_600_000).toFixed(1)} h`} sub="no limits on hours" />
        <Stat label="Space used" value={formatBytes(bytes)} sub="by this show" testId="studio-bytes" />
        <Stat
          label="Live now"
          value={live ? formatClock(now - live.startedAt) : "—"}
          sub={live ? `${live.people.length || 1} ${live.people.length === 1 ? "person" : "people"} recording` : "nobody recording"}
          live={!!live}
        />
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show sections">
        {(
          [
            ["episodes", "Episodes"],
            ["settings", "Settings"],
            ["space", "Space used"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "cursor-pointer rounded-full border px-[18px] py-[9px] text-[15px] font-medium whitespace-nowrap",
              tab === key ? "border-ink bg-ink text-ink-text" : "border-border-strong text-text hover:border-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "episodes" && (
        <>
          <Card className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1">
              <h2 className="text-[19px] font-semibold">Invite link for guests</h2>
              <p className="text-[15px] text-muted">
                Send this to your guests. They open it in their browser, with nothing to install and no account needed.
                They can join once you&apos;ve entered the studio.
              </p>
            </div>
            <InviteLink studioId={show.id} inviteCode={show.inviteCode} />
          </Card>
          {checks.length > 0 && <TechChecks checks={checks} />}
          <EpisodeList
            showId={show.id}
            episodes={episodes}
            now={now}
            levelLoudness={show.settings.levelLoudness}
            onChange={setEpisodes}
          />
        </>
      )}

      {tab === "settings" && (
        <>
          <Card className="flex max-w-[760px] flex-col gap-6 p-7">
            <h2 className="text-[19px] font-semibold">Show settings</h2>
            <ShowSettingsForm studioId={show.id} name={show.name} settings={show.settings} />
          </Card>
          <section className="flex max-w-[760px] flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-accent-line px-7 py-6">
            <span className="flex flex-col gap-1">
              <span className="text-[17px] font-semibold">Delete this show</span>
              <span className="text-sm text-muted">Removes the show, its invite link and every episode in it, including the files.</span>
            </span>
            <DeleteShowButton studioId={show.id} name={show.name} episodes={episodes.length} />
          </section>
        </>
      )}

      {tab === "space" && <SpaceUsed shows={shows} />}
    </>
  );
}

function Stat({ label, value, sub, live, testId }: { label: string; value: string; sub: string; live?: boolean; testId?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-[18px] bg-surface-2 p-[22px]">
      <span className="text-sm text-muted">{label}</span>
      <span
        className={cn("text-[clamp(24px,2.4vw,32px)] font-medium tracking-[-.02em] whitespace-nowrap", live && "text-accent-strong")}
        data-testid={testId}
      >
        {value}
      </span>
      <span className="text-[13px] text-subtle">{sub}</span>
    </div>
  );
}

const BAR_COLORS = ["bg-accent", "bg-ink", "bg-muted", "bg-warn", "bg-ok"];

function SpaceUsed({ shows }: { shows: Array<{ id: string; name: string; bytes: number }> }) {
  const total = shows.reduce((n, s) => n + s.bytes, 0);
  return (
    <Card className="flex flex-col gap-5 p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[19px] font-semibold">Space used by your shows</h2>
        <span className="text-[15px] text-muted">{formatBytes(total)} in total</span>
      </div>
      <div className="flex h-3.5 overflow-hidden rounded-full bg-border" aria-hidden>
        {shows.map((s, i) => (
          <div key={s.id} className={BAR_COLORS[i % BAR_COLORS.length]} style={{ width: `${total ? (s.bytes / total) * 100 : 0}%` }} />
        ))}
      </div>
      <ul className="flex flex-col">
        {shows.map((s, i) => (
          <li key={s.id} className="flex justify-between gap-3 border-b border-border py-3.5 text-[15px] last:border-0">
            <span className="flex items-center gap-2.5">
              <span className={cn("size-2.5 rounded-[3px]", BAR_COLORS[i % BAR_COLORS.length])} />
              {s.name}
            </span>
            <span className="text-text-2">{formatBytes(s.bytes)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        Tip: each person recorded in Full HD adds about 3.6 GB per hour (1.8 GB in Standard), plus the processed files.
        Deleting an episode frees its space right away.
      </p>
    </Card>
  );
}

/** The current time, updated every `ms` (or not at all when null). */
function useNow(ms: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** What guests' tech checks found, newest first: "All good", or what to sort out before the session. */
function TechChecks({ checks }: { checks: TechCheck[] }) {
  return (
    <Card className="flex flex-col gap-3.5">
      <h2 className="text-[19px] font-semibold">Tech checks</h2>
      <ul className="flex flex-col divide-y divide-border">
        {checks.map((c) => {
          const issues = c.checks.filter((x) => x.tone !== "ok");
          return (
            <li key={c.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0" data-testid="tech-check">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[15px]">
                <span>
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted"> · {c.browser}</span>
                </span>
                <span className="text-[13px] text-subtle">{timeAgo(c.checkedAt)}</span>
              </span>
              {issues.length === 0 ? (
                <span className="text-sm text-ok-strong">✓ All good</span>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {issues.map((x) => (
                    <li key={x.id} className={x.tone === "danger" ? "text-danger" : "text-warn-strong"}>
                      ! {x.label}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function timeAgo(ms: number) {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
