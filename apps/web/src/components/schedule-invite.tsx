"use client";

// "Schedule a session": pick a day and time, get a calendar file to send to guests. It holds
// the invite link and the tech-check link, so the reminder in their calendar has both.
import { useState, type FormEvent } from "react";
import { sessionInvite } from "@/lib/ics";
import { Button } from "./ui";

export function ScheduleInvite({ studioName, hostName, inviteCode }: { studioName: string; hostName: string; inviteCode: string }) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function make(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    // The browser reads date and time in this computer's time zone; the file carries it as UTC.
    const startMs = new Date(`${data.get("date")}T${data.get("time")}`).getTime();
    if (!Number.isFinite(startMs)) return setProblem("Choose a day and a time.");
    setProblem(null);
    const origin = window.location.origin;
    const ics = sessionInvite({
      studio: studioName,
      host: hostName,
      startMs,
      minutes: Number(data.get("minutes")) || 60,
      joinUrl: `${origin}/join/${inviteCode}`,
      checkUrl: `${origin}/join/${inviteCode}/check`,
      uid: `${crypto.randomUUID()}@tapry`,
      nowMs: Date.now(),
    });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: `Recording - ${studioName.replace(/[\\/:*?"<>|]+/g, " ").trim()}.ics` }).click();
    URL.revokeObjectURL(url);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="cursor-pointer self-start text-[13.5px] font-medium text-text underline underline-offset-[3px]" data-testid="schedule-open">
        Schedule a session: make a calendar invite
      </button>
    );
  }
  const field = "h-[34px] rounded-md border border-border bg-surface px-2.5 text-sm text-text shadow-xs focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none";
  return (
    <form onSubmit={make} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5" data-testid="schedule">
      <span className="text-[13.5px] leading-normal text-pretty text-muted">
        Makes a calendar file with the invite link and the tech-check link. Send it to your guests, or open it and invite them from your own calendar. The time is in this computer&apos;s time
        zone; their calendars show it in theirs.
      </span>
      <span className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Day
          <input type="date" name="date" required className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Time
          <input type="time" name="time" required className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Length
          <select name="minutes" defaultValue="60" className={field}>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="90">1 hour 30</option>
            <option value="120">2 hours</option>
          </select>
        </label>
        <Button type="submit" size="sm">
          Download the invite
        </Button>
      </span>
      {problem && (
        <span role="alert" className="text-[13px] text-danger">
          {problem}
        </span>
      )}
    </form>
  );
}
