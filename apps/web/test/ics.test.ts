import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sessionInvite } from "../src/lib/ics";

describe("calendar invite for a session", () => {
  const ics = sessionInvite({
    studio: "Voices; of the Rif, season 2",
    host: "Ines",
    startMs: Date.UTC(2026, 10, 20, 14, 30),
    minutes: 90,
    joinUrl: "https://studio.example.com/join/abc123",
    checkUrl: "https://studio.example.com/join/abc123/check",
    uid: "uid-1@tapry",
    nowMs: Date.UTC(2026, 10, 13, 9, 0),
  });
  if (process.env.ICS_SAMPLE) writeFileSync(process.env.ICS_SAMPLE, ics);
  const unfolded = ics.replace(/\r\n /g, "");

  it("is a calendar event at that time, in UTC, with both links and a reminder", () => {
    expect(unfolded).toContain("BEGIN:VEVENT\r\nUID:uid-1@tapry\r\nDTSTAMP:20261113T090000Z\r\nDTSTART:20261120T143000Z\r\nDTEND:20261120T160000Z");
    expect(unfolded).toContain("SUMMARY:Recording: Voices\; of the Rif\\, season 2");
    expect(unfolded).toContain("https://studio.example.com/join/abc123/check");
    expect(unfolded).toContain("URL:https://studio.example.com/join/abc123");
    expect(unfolded).toContain("TRIGGER:-PT15M");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("keeps every line within 75 bytes, as calendars require", () => {
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfolded).toContain("DESCRIPTION:Ines has invited you to a recording in Voices\; of the Rif\\, season 2.\\n\\nJoin here");
  });
});
