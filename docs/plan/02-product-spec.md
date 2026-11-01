# 02 — Product Spec

## Core flow (v1)

1. **Host creates a studio** (name, quality, max guests, consent text).
2. **Host shares a permanent studio link.** Guests open it in Chrome/Edge/Firefox/Safari — **no account, no install**.
3. **Green room:** device pickers, mic level meter, camera preview, headphones prompt, network + free-disk check, **consent checkbox** ("I agree to be recorded").
4. **Record:** host presses Record → every participant records locally; a low-res live call runs in parallel.
5. **During recording:** each device uploads chunks continuously. Host sees **per-guest status** ("Guest 2: recording · 98% safely uploaded") and **quality alerts** (mic clipping, echo, low disk, upload falling behind).
6. **Stop:** remaining chunks finish ("Don't close this tab — 92% uploaded"). Guests who leave early resume on next visit.
7. **Processing:** tracks assembled, synced, loudness-normalised; combined video rendered; transcript generated **on the server you control**. Status shown as a timeline (uploading → syncing → processing → ready).
8. **Download / export:** per-person audio (WAV/FLAC) + video (MP4) + combined video + transcript (SRT/VTT/TXT/DOCX) + **editor project file** with aligned tracks, or a zip.

## Features by phase

> v3 additions: AI details in `12-ai-features.md`, growth features in `13-growth-features.md`, Riverside decisions in `14-riverside-parity.md`. Phase tags there override anything below.

### v1 — MVP (open-source launch, late Jan 2027) — **Reliability**
- **AI producer alerts + talk balance** on the host screen (see `12` §A).
- **Guest tech-check link** before the session; **guest end screen + recap email** ("Record your own — free").
- **Free tools (no sign-up):** mic & camera test, upload-speed check.
- Audio-only mode.
- Studios, invite links, green room, 2–4 participants.
- Local recording per participant (audio + video), chunked upload with resume.
- **Live per-guest upload status** on the host screen.
- **Crash recovery:** guest's tab crashes → rejoin → leftover chunks upload, nothing lost.
- **In-call quality alerts:** clipping, echo, very low level, low disk, upload behind, guest on battery saver/background tab.
- Live call via LiveKit (low-res video + audio).
- Multitrack downloads + combined grid video.
- **Consent capture**: timestamped "I agree" per guest, stored with the session.
- **Transcripts with perfect speaker labels** (one track = one speaker), Whisper on CPU for self-host.
- Self-host with one command (Docker Compose).
- Admin: recordings list, processing timeline, storage usage, delete.

### v1.1 — Cloud beta (Feb–Apr 2027) — **Privacy + paid plans**
- Accounts, workspaces, billing, usage limits, retention settings.
- **Bring your own storage** (customer S3/R2/MinIO bucket).
- **Private AI on your own servers:** summaries and chapters with a local/self-hosted model; option to use an external API only if the workspace allows it.
- **Redaction:** auto-detect and mask names, emails, phone numbers, places in transcripts (review before export).
- **Retention policies:** auto-delete raw files/outputs after N days; deletion log.
- **Audit log** (who viewed, downloaded, deleted).
- EU hosting region for cloud; data processing agreement template.
- Audio cleanup: loudness, noise reduction.
- Custom branding; up to 8 participants.
- **Interview guide tracker + live notes/bookmarks**; run-of-show planner; templates (research, podcast, newsroom).
- Shows & series; scheduling + calendar invites; team roles + transcript comments; referral hours; share pages.
- Multi-language UI (FR, ES, AR, DE, PT); polished mobile-browser guests.
- Free tools: solo recorder, file transcript, consent form generator, GDPR data-flow template.

### v1.2 — Openness (May–Jul 2027)
- **Export to editors with aligned tracks:** DaVinci Resolve, Premiere (XML/FCPXML), Final Cut (FCPXML), Descript, CoProd (if it documents an import format).
- **Export to research software:** NVivo, ATLAS.ti, MAXQDA (transcripts with speakers + timestamps); Dovetail upload integration.
- Pseudonymised participant names in exports (P1, P2…).
- Simple cuts by transcript (trim start/end, remove sections across all tracks). **No full editor.**
- Webhooks + API.
- **Search across recordings + "ask your recordings"**, quote finder, research coding, silence/filler removal, subtitles.
- Solo mode (screen + camera); import from Zoom/Riverside/Drive; auto-send to Drive/Dropbox/YouTube/podcast hosts; Zapier/Make/n8n; embeddable player; guest list; education mode; template gallery; screen-share track.

### v2 — Organisations (Aug 2027+)
- SSO (SAML/OIDC), roles, admin policies (who can record/download), in `/ee`.
- Screen-share track; RTMP live streaming.
- **Embeddable recorder** (MIT library + hosted option) for platforms.
- Producer mode (notes, cue cards, guest device control).
- Live follow-up suggestions; live captions/translation; async interviews/testimonials; Slack/Discord bot; plugin system; live streaming.

## Non-goals
- Full video editor or AI editing suite (Riverside/Descript/CoProd own this).
- Generative AI features: B-roll, eye contact, voice cloning, dubbing, avatars, viral clip generation.
- Podcast hosting/RSS.
- Webinars with 100+ attendees.
- Native mobile apps (only if > 15–20% of guests join from phones).

## UX principles
- **Never lose a recording.** Upload state always visible; warn before closing; recover after crashes.
- Guest flow under 30 seconds.
- Clear states everywhere: Recording / Uploading / Syncing / Processing / Ready / Failed (with retry).
- Fast, light studio page (speed is the #1 complaint about Riverside).
- **Self-hosted works exactly like cloud.**
- Privacy defaults on: consent required, AI local by default, no media in logs.
