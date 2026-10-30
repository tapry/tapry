# 02 — Product Spec

## Core flow (v1)

1. **Host creates a studio** (name, video quality, max guests).
2. **Host shares a link.** Guests open it in Chrome/Edge/Firefox/Safari — **no account, no install**.
3. **Green room:** device pickers, mic level meter, camera preview, "use headphones" tip, network/storage check.
4. **Record:** host presses Record → every participant starts recording locally; a live low-res call runs in parallel.
5. **During recording:** each device uploads chunks continuously; per-person upload progress visible to host.
6. **Stop:** remaining chunks finish uploading ("Don't close this tab yet — 92% uploaded").
7. **Post-processing:** tracks assembled, synced, normalized; combined video rendered; transcript generated.
8. **Download:** per-person audio (WAV/FLAC) + video (MP4) + combined video + transcript (SRT/VTT/TXT), or zip.

## Features by phase

### v1 — MVP (open-source launch)
- Studios, invite links, green room, 2–4 participants.
- Local recording per participant (audio + video), chunked upload with resume.
- Live call via LiveKit (low-res preview, audio).
- Multitrack downloads + simple combined video (grid layout).
- Recovery: if a tab crashes, chunks saved locally are uploaded on reopen.
- Self-host with one command (Docker Compose).
- Basic admin: recordings list, storage usage, delete.

### v1.1 — Cloud beta (paid)
- Accounts, teams, billing, usage limits (hours/month, retention).
- Transcripts (Whisper), speaker labels.
- Audio cleanup: loudness normalization, noise reduction.
- Custom branding (logo, colors) on studio page.
- Up to 8 participants.

### v2 — Differentiators
- **Edit by transcript** (delete words → cut all tracks in sync) → "open-source Descript" built in.
- AI: show notes, chapters, titles, social clips.
- Screen share recording (separate track).
- Live streaming to YouTube/Twitch (RTMP egress).
- "Bring your own storage" (customer S3 bucket) for cloud users.
- API + webhooks for platforms.

### v3 — Business
- SSO (SAML/OIDC), audit logs, data residency, retention policies.
- Producer mode (host controls guests' devices, notes, cue cards).
- Mobile web improvements; native iOS/Android guest apps if needed.

## Non-goals (for now)
- Full video editor (export to Descript/Premiere/DaVinci instead).
- Podcast hosting/RSS (integrate later).
- Webinars with 100+ attendees.

## UX principles
- **Never lose a recording.** Upload progress always visible; warn before closing tab.
- Guest flow under 30 seconds.
- Clear states: Recording / Uploading / Processing / Ready.
- Everything works on a self-hosted install exactly like cloud.
