// Summaries of CHANGELOG.md, newest first. Keep in step with each release.
export type Release = { version: string; title: string; body: string; date?: string };

export const releases: Release[] = [
  {
    version: "0.3.0",
    title: "Recap email, sturdier recordings, studios and recordings",
    body: "Guests can ask for an email linking to their own recording. One unreadable track no longer costs everyone their files, and a late track triggers another run. A setup code protects a new install's first account. The app now says studios and recordings.",
    date: "7 November 2026",
  },
  {
    version: "0.2.0",
    title: "AI producer, guest tech check, consent records",
    body: "Live alerts for distorting, silent, too quiet and echoing mics, plus talk balance. A tech-check link for guests, a guest end screen, consent text per studio with a consent record, audio-only studios, FLAC and Word exports, a processing timeline and a server health page. Renamed from OpenTake.",
    date: "2 November 2026",
  },
  {
    version: "0.1.1",
    title: "Fixes for the call and finishing uploads",
    body: "Firefox now sends the call's video at 360p, the page waits for the last piece after Stop before saying everything is uploaded, and failed call attempts reconnect one at a time.",
  },
  {
    version: "0.1.0",
    title: "First release",
    body: "The complete flow, self-hosted with Docker Compose: guest links and a green room, local recording that survives dropped connections and closed tabs, a live call with TURN, per-person WAV and MP4, a combined video, -16 LUFS levelling and transcripts.",
  },
];
