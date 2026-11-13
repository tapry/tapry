// The "Recording" choices of a studio, shared by the New studio screen and its settings.
import type { StudioSettings, VideoQuality } from "@tapry/shared";

export type QualityChoice = VideoQuality | "audio";

/** [value, name, what it means, can't be chosen]. 4K is offered to everyone and says when the plan lacks it. */
export function qualityOptions(can4k: boolean): Array<readonly [QualityChoice, string, string, boolean]> {
  return [
    ["2160p", "4K", can4k ? "Each camera's best, up to 4K. Much larger files" : "On the Studio plan and up", !can4k],
    ["1080p", "Full HD", "Best quality, larger files", false],
    ["720p", "Standard", "Smaller files, still sharp", false],
    ["audio", "Audio only", "Sound only, no cameras", false],
  ];
}

/** "4K video", "Full HD video", "Standard video" or "Audio only", for lists of studios. */
export function recordingLabel(settings: Pick<StudioSettings, "audioOnly" | "videoQuality">) {
  if (settings.audioOnly) return "Audio only";
  return settings.videoQuality === "2160p" ? "Up to 4K video" : settings.videoQuality === "1080p" ? "Full HD video" : "Standard video";
}
