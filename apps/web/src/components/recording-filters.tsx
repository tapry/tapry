"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/client/api";
import { Icon, Spinner } from "./ui-extra";
import { Button } from "./ui";

export type FilterFailure = { name: string; kind: "audio" | "video" };

/** "Sam Guest's video", "Sam Guest's video and audio, and Bo's audio": each person once, with their files. */
export function describeFilterFailures(failed: FilterFailure[]) {
  const byName = new Map<string, Set<string>>();
  for (const f of failed) byName.set(f.name, (byName.get(f.name) ?? new Set()).add(f.kind));
  const and = (items: string[], oxford = false) =>
    items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${items.at(-1)}`;
  const people = [...byName].map(([name, kinds]) => `${name}'s ${and(["video", "audio"].filter((k) => kinds.has(k)))}`);
  // With "video and audio" inside an item, a comma keeps people apart.
  return people.length === 2 && people.some((p) => p.includes(" and ")) ? people.join(", and ") : and(people, true);
}

/**
 * For a recording where someone chose filters: whether these files have them, and the way to
 * make the files again the other way (the same "process" call as Try again, with the choice).
 * The uploads are never filtered, so either way is always possible while they're kept.
 */
export function RecordingFilters({
  studioId,
  recordingId,
  applyFilters,
  filtersFailed = [],
  rawDeleted,
  onQueued,
}: {
  studioId: string;
  recordingId: string;
  applyFilters: boolean;
  /** Files of this run that are as recorded, because that person's filters couldn't be applied. */
  filtersFailed?: FilterFailure[];
  /** The original uploads are gone (retention): the files can't be made again. */
  rawDeleted: boolean;
  /** Processing was queued with this choice. Without it, the page is refreshed. */
  onQueued?: (applyFilters: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function processAgain() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/studios/${studioId}/recordings/${recordingId}/process`, { body: { filters: !applyFilters } });
      if (onQueued) onQueued(!applyFilters);
      else router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't start processing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="recording-filters" data-filters={applyFilters ? "applied" : "off"}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[14px] text-muted">
        <span className="flex min-w-0 flex-[1_1_240px] items-start gap-2 text-pretty">
          <Icon name="sliders" size={15} className="mt-px" />
          <span>
            <span className="font-medium text-text-2">{applyFilters ? "Filters applied" : "Without filters"}</span>
            {applyFilters
              ? ": these files have the look and sound each person chose. Their original recordings are kept."
              : ": these files are as recorded, though someone chose filters."}
          </span>
        </span>
        {!rawDeleted && (
          <Button variant="link" disabled={busy} onClick={processAgain} data-testid="process-filters">
            {busy && <Spinner size={13} />}
            {applyFilters ? "Process again without filters" : "Process again with filters"}
          </Button>
        )}
      </div>
      {applyFilters && filtersFailed.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-lg bg-warn-soft px-3.5 py-3 text-sm leading-normal text-pretty text-warn-strong" data-testid="filters-failed">
          <Icon name="alert" size={15} className="mt-0.5" />
          <span>
            Filters couldn&apos;t be applied to {describeFilterFailures(filtersFailed)}, so {filtersFailed.length === 1 ? "it's" : "they're"} as recorded.
          </span>
        </div>
      )}
      {error && <p className="text-[14px] text-accent-strong">{error}</p>}
    </div>
  );
}
