# 08 — Roadmap (from 2 Nov 2026, ~15–25 h/week alongside freelancing)

## Week 0 (1–2 Nov 2026)
- [ ] Buy **tapry.app**; create GitHub org **tapry**; grab @tapry handles; quick trademark search.
- [ ] One-page waitlist on tapry.app; first build-in-public post.

## Phase 0 — Technical prototype (2–15 Nov 2026)
- [ ] `packages/recorder` prototype: getUserMedia → MediaRecorder (timeslice) → OPFS → presigned multipart upload to MinIO.
- [ ] Chrome + Safari + Firefox: 60-min recording, throttled network, tab crash + rejoin recovery.
- [ ] Clock-offset sync between 2 browsers; align with ffmpeg; measure drift.
- [ ] Per-guest upload progress sent to host (metadata channel).
- [ ] LiveKit local setup with 2 participants.
- **Gate A:** 60-min, 2-person recording, **zero data loss**, < 50 ms sync error on Chrome + Safari. Safari fails → launch Chrome-first, Safari "beta". Chrome also fails → stop and reassess.

## Phase 1 — MVP (16 Nov – 27 Dec 2026)
- [ ] Studios, permanent invite links, green room (devices, levels, disk check, **consent checkbox**).
- [ ] Host-controlled record/stop; **per-guest live status**; **quality alerts** (clipping, echo, low disk, upload behind, tab hidden).
- [ ] Crash recovery flow.
- [ ] Worker: concatenate, normalise, align, per-track WAV/MP4, combined grid video, zip.
- [ ] Transcripts (whisper.cpp CPU) with speaker = track.
- [ ] Processing timeline UI (uploading → syncing → processing → ready).
- [ ] AI producer alerts + talk balance; audio-only mode.
- [x] Guest tech-check link; guest end screen + recap email.
- [ ] Free pages: mic & camera test, upload-speed check (SEO from day one).
- [ ] Docker Compose self-host + docs + admin health page.
- [ ] Landing page + waitlist; start building in public.
- [ ] Recruit 20 alpha users (10 creators, 10 researchers/journalists).

## Phase 2 — Alpha + validation (Jan 2027)
- [ ] 20 alpha users, 50+ real recordings.
- [ ] Fix every lost-data or sync bug; full test matrix (`03` §8); publish it.
- [ ] **10 interviews with research teams / university IT / newsrooms**: do they buy a separate tool? who pays? card or procurement?
- **Gate B:** 100% of recordings recovered; ≥ 70% of alpha users record a second session.

## Phase 3 — Open-source launch (late Jan 2027)
- [ ] Launch week (`07`); founding offers open (`06`).
- [ ] Daily issue replies; weekly releases.
- **Gate C (4 weeks after launch):** ≥ 1,000 stars **or** ≥ 100 self-hosted installs **or** ≥ 500 waitlist sign-ups **or** ≥ 50 founding offers. None → rethink positioning before building cloud.

## Phase 4 — Cloud beta + privacy (Feb – Apr 2027)
- [ ] Accounts, workspaces, billing (Paddle/Lemon Squeezy — payouts to Morocco confirmed first), usage limits.
- [ ] **BYO storage** plan.
- [ ] Private AI (local model) summaries/chapters; AI mode per workspace.
- [ ] **Redaction**, retention policies, audit log, EU region, DPA template.
- [ ] Audio cleanup; branding; up to 8 participants.
- [ ] Interview guide tracker, live notes, run-of-show, templates, shows/series, scheduling, team roles, referral hours, share pages.
- [ ] Multi-language UI; free tools (solo recorder, transcript, consent form, GDPR template); self-host app store listings.
- [ ] Start organisation pilots.
- **Gate D (end Apr 2027):** ≥ 30 paying cloud users **and** ≥ 3 organisation pilots running.

## Phase 5 — Openness (May – Jul 2027)
- [ ] Editor exports (Resolve, Premiere, Final Cut, Descript; CoProd if possible).
- [ ] Research exports (NVivo, ATLAS.ti, MAXQDA), Dovetail integration, pseudonymised names.
- [ ] Simple cuts by transcript (no full editor).
- [ ] API + webhooks.
- [ ] Search + ask your recordings, quote finder, research coding, silence/filler removal, subtitles.
- [ ] Solo mode; imports (Zoom/Riverside/Drive); auto-send integrations; Zapier/Make/n8n; embeddable player; education mode.

## Phase 6 — Organisations (Aug – Sep 2027)
- [ ] SSO, roles, admin policies (`/ee`); screen-share track; RTMP streaming.
- [ ] First organisation licences.
- **Gate E (Sep 2027):** ≥ $3k MRR **or** ≥ 3 paying organisations → double down (consider funding). Else keep as open-source/portfolio project and reduce time.

## Kill / pivot signals at any gate
- Data loss you can't fix → stop (reliability is the whole product).
- Stars but no payers by Gate D → focus on organisation licences only, or keep as portfolio.
- Organisations interested but can't buy (procurement) → offer card-payable Research team plan; if still nothing, drop the organisation focus and go creator-only.
