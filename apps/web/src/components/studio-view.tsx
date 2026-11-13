"use client";

import { SoloLink } from "./solo-link";
import { GuideEditor } from "./guide-editor";
import { recordingLabel } from "@/components/quality-options";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { formatBytes, formatClock } from "@/lib/format";
import type { RecordingSummary } from "@/server/processing";
import type { Studio, TechCheck } from "@/server/studios";
import { RecordingList, settled } from "./recording-list";
import { DeleteStudioButton, InviteLink, OpenStudioButton, StudioSettingsForm } from "./studio-forms";
import { Icon, ListCard } from "./ui-extra";
import { Avatar, cn } from "./ui";

type Tab = "recordings" | "settings" | "space";

/** One studio: its header, numbers, and the Recordings / Settings / Space used tabs. */
export function StudioView({
  studio,
  recordings: initial,
  checks,
  studios,
  hostName,
  guide,
  solo,
  can4k = true,
}: {
  studio: Studio;
  hostName: string;
  /** The studio's guide (run of show). */
  guide: string;
  /** The studio's solo link (its code when on) and its questions. */
  solo: { code: string | null; prompt: string };
  /** This account's studios may record in 4K. */
  can4k?: boolean;
  recordings: RecordingSummary[];
  checks: TechCheck[];
  studios: Array<{ id: string; name: string; bytes: number }>;
}) {
  const [tab, setTab] = useState<Tab>("recordings");
  const [recordings, setRecordings] = useState(initial);
  useEffect(() => setRecordings(initial), [initial]);
  const now = useNow(recordings.some((e) => e.status === "recording") ? 1000 : null);

  // Keep the list fresh while anything is recording, uploading or processing.
  const inFlight = recordings.some((e) => !settled(e));
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(async () => {
      try {
        setRecordings((await apiFetch<{ recordings: RecordingSummary[] }>(`/studios/${studio.id}/recordings`)).recordings);
      } catch {
        // Keep showing the last known state; the next poll retries.
      }
    }, 3000);
    return () => clearInterval(id);
  }, [studio.id, inFlight]);

  const live = recordings.find((e) => e.status === "recording");
  const ready = recordings.filter((e) => e.processing === "ready").length;
  const recordedMs = recordings.reduce((n, e) => n + ((e.stoppedAt ?? now) - e.startedAt), 0);
  const bytes = recordings.reduce((n, e) => n + e.bytes, 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-.025em] break-words">{studio.name}</h1>
          <span className="text-sm text-pretty text-muted">
            {recordingLabel(studio.settings)} · up to {studio.settings.maxGuests}{" "}
            guest{studio.settings.maxGuests === 1 ? "" : "s"} · started{" "}
            {new Date(studio.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>
        <OpenStudioButton studioId={studio.id} live={!!live} />
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat label="Recordings" value={String(recordings.length)} sub={`${ready} ready to download`} />
        <Stat label="Time recorded" value={`${(recordedMs / 3_600_000).toFixed(1)} h`} sub="no limits on hours" />
        <Stat label="Space used" value={formatBytes(bytes)} sub="by this studio" testId="studio-bytes" />
        <Stat
          label="Live now"
          value={live ? formatClock(now - live.startedAt) : "—"}
          sub={live ? `${live.people.length || 1} ${live.people.length === 1 ? "person" : "people"} recording` : "nobody recording"}
          live={!!live}
        />
      </div>

      <div className="-mb-2 flex gap-1 overflow-x-auto border-b border-border pb-3" role="tablist" aria-label="Studio sections">
        {(
          [
            ["recordings", "Recordings"],
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
              // The focus ring is drawn inside: the tab list scrolls sideways, which would clip one outside.
              "cursor-pointer rounded-md border px-[11px] py-[5px] text-sm whitespace-nowrap transition-colors duration-[250ms] focus-visible:-outline-offset-2",
              tab === key ? "border-border bg-surface font-medium text-text shadow-xs" : "border-transparent text-muted hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "recordings" && (
        <>
          <section className="flex flex-col gap-2.5">
            <h2 className="font-medium">Invite guests</h2>
            <InviteLink studioId={studio.id} inviteCode={studio.inviteCode} />
            <p className="text-[13px] text-muted">They open it in their browser, with nothing to install and no account needed.</p>
          </section>
          {checks.length > 0 && <TechChecks checks={checks} />}
          <RecordingList
            studioId={studio.id}
            recordings={recordings}
            now={now}
            levelLoudness={studio.settings.levelLoudness}
            onChange={setRecordings}
          />
        </>
      )}

      {tab === "settings" && (
        <>
          <StudioSettingsForm studioId={studio.id} name={studio.name} settings={studio.settings} hostName={hostName} can4k={can4k} />
          <GuideEditor studioId={studio.id} initial={guide} />
          <SoloLink studioId={studio.id} initial={solo} />
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent-line bg-surface px-[18px] py-4">
            <span className="flex flex-[1_1_260px] flex-col gap-[3px]">
              <span className="font-medium">Delete this studio</span>
              <span className="text-[13px] text-muted">Removes the studio, its invite link and every recording in it, including the files.</span>
            </span>
            <DeleteStudioButton studioId={studio.id} name={studio.name} recordings={recordings.length} />
          </section>
        </>
      )}

      {tab === "space" && <SpaceUsed studios={studios} />}
    </>
  );
}

function Stat({ label, value, sub, live, testId }: { label: string; value: string; sub: string; live?: boolean; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-[18px] sm:px-5">
      <span className="text-[13px] text-muted">{label}</span>
      <span
        className={cn("text-[22px] font-medium tracking-[-.02em] whitespace-nowrap tabular-nums", live && "text-accent-strong")}
        data-testid={testId}
      >
        {value}
      </span>
      <span className="text-[12.5px] text-muted">{sub}</span>
    </div>
  );
}

const BAR_COLORS = ["bg-ink", "bg-muted", "bg-border-strong", "bg-accent", "bg-warn"];

function SpaceUsed({ studios }: { studios: Array<{ id: string; name: string; bytes: number }> }) {
  const total = studios.reduce((n, s) => n + s.bytes, 0);
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap justify-between gap-2 text-[13px] text-muted">
          <span>Space used by your studios</span>
          <span>{formatBytes(total)} in total</span>
        </span>
        <div className="flex h-2 overflow-hidden rounded bg-surface-2" aria-hidden>
          {studios.map((s, i) => (
            <span key={s.id} className={BAR_COLORS[i % BAR_COLORS.length]} style={{ width: `${total ? (s.bytes / total) * 100 : 0}%` }} />
          ))}
        </div>
      </div>
      <ListCard>
        <span className="border-b border-border pt-3 pb-2 text-[13px] text-muted">By studio</span>
        <ul className="flex flex-col">
          {studios.map((s, i) => (
            <li key={s.id} className="flex justify-between gap-3 border-b border-divider py-3 last:border-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("size-2 shrink-0 rounded-[2px]", BAR_COLORS[i % BAR_COLORS.length])} />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="whitespace-nowrap text-text-2 tabular-nums">{formatBytes(s.bytes)}</span>
            </li>
          ))}
        </ul>
      </ListCard>
      <p className="text-[13px] text-muted">
        Tip: each person recorded in Full HD adds about 3.6 GB per hour (1.8 GB in Standard), plus the processed files.
        Deleting a recording frees its space right away.
      </p>
    </>
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
    <section className="flex flex-col gap-2.5">
      <h2 className="font-medium">Tech checks</h2>
      <ListCard>
        <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,.8fr)_minmax(0,1.3fr)] gap-4 border-b border-border py-2.5 text-[13px] text-muted sm:grid">
          <span>Guest</span>
          <span>Checked</span>
          <span>Result</span>
        </div>
        <ul className="flex flex-col">
          {checks.map((c) => {
            const issues = c.checks.filter((x) => x.tone !== "ok");
            return (
              <li
                key={c.id}
                className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 border-b border-divider py-3 last:border-0 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,.8fr)_minmax(0,1.3fr)]"
                data-testid="tech-check"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={c.name} className="size-7 text-[11px]" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="truncate text-[13px] text-muted">{c.browser}</span>
                  </span>
                </span>
                <span className="text-muted">{timeAgo(c.checkedAt)}</span>
                {issues.length === 0 ? (
                  <span className="flex items-center gap-[7px] whitespace-nowrap text-ok-strong">
                    <Icon name="shield" /> All good
                  </span>
                ) : (
                  <ul className="flex flex-col gap-1 text-[13.5px]">
                    {issues.map((x) => (
                      <li key={x.id} className={cn("flex items-start gap-[7px]", x.tone === "danger" ? "text-danger" : "text-warn-strong")}>
                        <Icon name="alert" size={15} className="mt-0.5" />
                        {x.label}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </ListCard>
    </section>
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
