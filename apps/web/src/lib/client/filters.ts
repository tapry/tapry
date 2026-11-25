"use client";

import { readStored, writeStored } from "./stored";
import { NO_FILTERS, trackFilters, type TrackFilters } from "@tapry/shared";
import { useSyncExternalStore } from "react";
import { apiFetch } from "./api";

// ── What this person chose, per device ───────────────────────────────────────
//
// Filters never touch the recorder: it keeps the untouched camera and microphone. They are shown
// on the call's copies and in this person's own preview, sent to the server with each track, and
// applied to the finished files there.

/** The name under which a person's filters are remembered in this browser (lib/client/stored.ts). */
export const FILTERS_KEY = "filters";

export interface FilterPrefs {
  filters: TrackFilters;
  /** "Mirror my view": flips only this person's own preview. Never sent, never in the files. */
  mirror: boolean;
  /** "Others see me mirrored": everyone's screen shows this person flipped in the call. Never in the files. */
  mirrorForOthers: boolean;
}

/** No filters, and your own view mirrored, as it always was. */
export const DEFAULT_PREFS: FilterPrefs = { filters: NO_FILTERS, mirror: true, mirrorForOthers: false };

/** What storage holds, read safely: anything unreadable or out of range means no filters. */
export function parsePrefs(raw: string | null | undefined): FilterPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const value = JSON.parse(raw) as { filters?: unknown; mirror?: unknown; mirrorForOthers?: unknown } | null;
    if (!value || typeof value !== "object") return DEFAULT_PREFS;
    const filters = trackFilters.safeParse(value.filters ?? {});
    return {
      filters: filters.success ? filters.data : NO_FILTERS,
      mirror: typeof value.mirror === "boolean" ? value.mirror : DEFAULT_PREFS.mirror,
      mirrorForOthers: typeof value.mirrorForOthers === "boolean" ? value.mirrorForOthers : DEFAULT_PREFS.mirrorForOthers,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/**
 * What a person's choices mean for their finished files: their filters, and "Others see me
 * mirrored", which flips their video as the call shows it. This is what goes to the server.
 */
export const fileFilters = (prefs: FilterPrefs): TrackFilters => (prefs.mirrorForOthers ? { ...prefs.filters, mirrored: true } : prefs.filters);

/** A track's filters as kept in its `meta` (strings only); undefined for tracks from before filters. */
export function parseFilters(raw: string | undefined): TrackFilters | undefined {
  if (!raw) return undefined;
  try {
    const filters = trackFilters.safeParse(JSON.parse(raw));
    return filters.success ? filters.data : undefined;
  } catch {
    return undefined;
  }
}

let prefs: FilterPrefs | undefined;
const listeners = new Set<() => void>();

/** The current choice: read from storage once per page, then kept in memory. */
export function getFilterPrefs(): FilterPrefs {
  if (!prefs) {
    try {
      prefs = parsePrefs(readStored(FILTERS_KEY));
    } catch {
      prefs = DEFAULT_PREFS; // no storage (private mode, blocked site data): nothing is remembered
    }
  }
  return prefs;
}

export function setFilterPrefs(next: FilterPrefs) {
  prefs = next;
  try {
    writeStored(FILTERS_KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((fn) => fn());
}

/** Forget what was read, so the next read comes from storage again (tests). */
export function reloadFilterPrefs() {
  prefs = undefined;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** This device's filters and mirror choice, shared by the green room, the room and the call. */
export function useFilterPrefs(): [FilterPrefs, (next: FilterPrefs) => void] {
  return [useSyncExternalStore(subscribe, getFilterPrefs, () => DEFAULT_PREFS), setFilterPrefs];
}

// ── Telling the server about a change during a session ───────────────────────

// The server applies a change only to tracks it already knows. A track that registers late
// (the device was offline when Record was pressed) carries the filters it started with, so
// whoever is syncing hears about each registration and sends the current choice again if it differs.
const registrations = new Set<(sessionId: string, filters: TrackFilters | undefined) => void>();

/** A track was registered with the server, with these filters (undefined: none sent). */
export function trackRegistered(sessionId: string, filters: TrackFilters | undefined) {
  registrations.forEach((fn) => fn(sessionId, filters));
}

export function onTrackRegistered(fn: (sessionId: string, filters: TrackFilters | undefined) => void) {
  registrations.add(fn);
  return () => void registrations.delete(fn);
}

export interface FilterSync {
  /** The person's filters now. Sent a moment later, unless they change again first. */
  set(filters: TrackFilters): void;
  /** A track just registered with these filters: if the choice has moved on since, send it again. */
  registered(filters: TrackFilters | undefined): void;
  stop(): void;
}

/** How long after a failed send the same choice goes again. */
const RETRY_MS = 3000;

/**
 * Sends a change of filters to the server (`PUT /sessions/:id/filters`), a moment after the last
 * change, with when the person made it (`now`: the server's clock as this device estimates it),
 * since their finished files follow the call from that moment. `initial` is what the person had
 * when they came in: new tracks carry their filters themselves, so nothing is sent until
 * something changes. A failed send goes again a few seconds later, with the time of the choice;
 * it never gets in the way of the recording.
 */
export function createFilterSync(
  ticket: { sessionId: string; token: string },
  initial: TrackFilters,
  opts: { delayMs?: number; retryMs?: number; now?: () => number; put?: (filters: TrackFilters, at: number | undefined) => Promise<unknown> } = {},
): FilterSync {
  const put =
    opts.put ??
    ((filters: TrackFilters, at: number | undefined) =>
      apiFetch(`/sessions/${ticket.sessionId}/filters`, { method: "PUT", body: { filters, ...(at !== undefined && { at }) }, token: ticket.token }));
  /** What the server has, as far as we know; null after a failure (so the next change always goes). */
  let sent: string | null = JSON.stringify(initial);
  let wanted = sent;
  /** When the wanted choice was made. */
  let wantedAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();

  const flush = () => {
    timer = undefined;
    // One request at a time, so an older choice can't arrive after a newer one.
    chain = chain.then(async () => {
      const body = wanted;
      if (body === sent) return;
      try {
        await put(JSON.parse(body) as TrackFilters, wantedAt);
        sent = body;
      } catch {
        sent = null;
        if (!stopped && timer === undefined) timer = setTimeout(flush, opts.retryMs ?? RETRY_MS);
      }
    });
  };

  return {
    set(filters) {
      const next = JSON.stringify(filters);
      if (next !== wanted) wantedAt = opts.now ? Math.round(opts.now()) : undefined;
      wanted = next;
      clearTimeout(timer);
      timer = wanted === sent ? undefined : setTimeout(flush, opts.delayMs ?? 400);
    },
    registered(filters) {
      if (JSON.stringify(filters ?? NO_FILTERS) === wanted) return;
      sent = null; // the server's copy for this track is older than the choice
      clearTimeout(timer);
      timer = setTimeout(flush, 0);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
