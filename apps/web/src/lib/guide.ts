// A studio's guide (run of show) as the room shows it. Plain text, one line each:
// "# Heading" lines are sections, every other line is an item the host ticks off.
export interface GuideLine {
  kind: "section" | "item";
  text: string;
}

export function parseGuide(guide: string): GuideLine[] {
  return guide
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): GuideLine => (line.startsWith("#") ? { kind: "section", text: line.replace(/^#+\s*/, "") } : { kind: "item", text: line.replace(/^[-*]\s+/, "") }))
    .filter((l) => l.text);
}

/** A guide item as a marker's label: one line, no control characters, at most 200 characters. */
export const markerLabel = (text: string) => text.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim().slice(0, 200) || "Marker";
