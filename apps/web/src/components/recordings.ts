// Shared by the studio page's inline list (a client component) and the dashboard's server pages:
// what a recording's state is called, and what each downloadable file is, in words.
import type { RecordingSummary } from "@/server/processing";
import type { IconName } from "./ui-extra";

type Recording = RecordingSummary;

export type StatusTone = "live" | "ok" | "danger" | "warn";

/** The studio page's wording: "Recording now", "Ready to download", "Getting files ready…". */
export function phase(e: Recording) {
  if (e.status === "recording") return { tone: "live", label: "Recording now" } as const;
  if (e.processing === "ready") return { tone: "ok", label: "Ready to download" } as const;
  if (e.processing === "failed") return { tone: "danger", label: "Something went wrong" } as const;
  if (e.processing === "queued" || e.processing === "processing") return { tone: "warn", label: "Getting files ready…" } as const;
  return { tone: "warn", label: e.incompleteTracks ? "Waiting for a guest" : "Finishing uploads" } as const;
}

/** The short form for lists and the sidebar: "Recording", "Ready", "Processing". */
export function shortStatus(e: Recording): { tone: StatusTone; label: string } {
  if (e.status === "recording") return { tone: "live", label: "Recording" };
  if (e.processing === "ready") return { tone: "ok", label: "Ready" };
  if (e.processing === "failed") return { tone: "danger", label: "Failed" };
  if (e.processing === "queued" || e.processing === "processing") return { tone: "warn", label: "Processing" };
  return { tone: "warn", label: e.incompleteTracks ? "Waiting for a guest" : "Uploading" };
}

/** Icon and text colour for each tone; the live one blinks. */
export const STATUS: Record<StatusTone, { icon: IconName; color: string; anim?: string }> = {
  live: { icon: "rec", color: "text-accent-strong", anim: "animate-rec-pulse" },
  ok: { icon: "check", color: "text-ok-strong" },
  danger: { icon: "alert", color: "text-accent-strong" },
  warn: { icon: "loader", color: "text-warn-strong" },
};

/** What a downloaded file is, in words: "Ines's audio", "Side-by-side video", "Captions (.srt)". */
export function describeOutput(o: Recording["outputs"][number]): { title: string; icon: IconName; format: string } {
  const ext = o.fileName.split(".").pop()?.toUpperCase() ?? "";
  if (o.kind === "combined") {
    // The mix of a recording without video is audio (WAV or FLAC); otherwise it's the grid video.
    return o.fileName.endsWith(".mp4") ? { title: "Side-by-side video", icon: "camera", format: ext } : { title: "Everyone, mixed", icon: "wave", format: ext };
  }
  if (o.kind === "transcript") {
    if (o.fileName.endsWith(".txt")) return { title: "Transcript", icon: "text", format: "Text" };
    if (o.fileName.endsWith(".docx")) return { title: "Transcript (Word)", icon: "file", format: "DOCX" };
    return { title: `Captions (.${ext.toLowerCase()})`, icon: "text", format: ext };
  }
  // "Sam Guest - audio (original).wav": their sound before noise removal, kept beside the cleaned file.
  const original = isOriginalAudio(o.fileName);
  const who = o.fileName.replace(/ - (audio|video|screen)( \(original\))?\.\w+$/, "");
  return { title: `${who}'s ${o.kind}${original ? " (original)" : ""}`, icon: o.kind === "audio" ? "wave" : o.kind === "screen" ? "screen" : "camera", format: ext };
}

/** A person's audio as recorded, which the worker keeps next to the file with noise removal. */
export const isOriginalAudio = (fileName: string) => / - audio \(original\)\.\w+$/.test(fileName);

/** Where a recording's file downloads from (the server redirects to a short-lived storage link). */
export const outputUrl = (studioId: string, recordingId: string, outputId: string) =>
  `/api/studios/${studioId}/recordings/${recordingId}/outputs/${outputId}`;
