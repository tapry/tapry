# 08 — Roadmap (from 2 Nov 2026, ~15–25 h/week)

## Phase 0 — Technical spike (Weeks 1–2: 2–15 Nov)
- [ ] Prototype `packages/recorder`: getUserMedia → MediaRecorder (timeslice) → OPFS → presigned multipart upload to MinIO.
- [ ] Test Chrome + Safari + Firefox, 60-min recording, throttled network, tab crash recovery.
- [ ] Clock-offset sync between 2 browsers; align with ffmpeg; measure drift.
- [ ] LiveKit local setup with 2 participants.
- **Gate A:** 60-min, 2-person recording with zero data loss and < 50 ms sync error on Chrome + Safari. If Safari fails → launch Chromium-first, Safari "beta".

## Phase 1 — MVP (Weeks 3–8: 16 Nov – 27 Dec)
- [ ] Studios, invite links, green room (devices, levels, storage check).
- [ ] Host-controlled record/stop for all participants; upload progress UI.
- [ ] Worker: concatenate, normalize, align, per-track WAV/MP4, combined grid video, zip download.
- [ ] Crash recovery flow.
- [ ] Docker Compose self-host (web, worker, postgres, redis, livekit, minio, caddy) + docs.
- [ ] README with demo video; landing page + waitlist.
- [ ] Recruit 20 alpha podcasters.

## Phase 2 — Alpha (Weeks 9–10: Jan 2027)
- [ ] 20 alpha users, 50+ real recordings.
- [ ] Fix every lost-data or sync bug; run full test matrix (`03`).
- **Gate B:** 100% recordings recovered; ≥ 70% of alpha users record a second session.

## Phase 3 — Public OSS launch (Weeks 11–12: late Jan 2027)
- [ ] Launch week plan (`07`).
- [ ] Respond to issues daily; weekly releases.
- **Gate C (4 weeks after launch):** ≥ 1,000 stars or ≥ 100 self-hosted installs or ≥ 500 cloud waitlist sign-ups. If none → reassess positioning before building cloud.

## Phase 4 — Cloud beta + transcripts (Feb–Apr 2027)
- [ ] Accounts, workspaces, billing (Paddle/Lemon Squeezy), usage limits.
- [ ] Transcription (Whisper), speaker = track.
- [ ] Audio cleanup (loudness, noise reduction).
- [ ] Custom branding; up to 8 participants.
- **Gate D (end Apr 2027):** ≥ 30 paying cloud users.

## Phase 5 — Differentiators (May–Sep 2027)
- [ ] Edit by transcript (multitrack cuts).
- [ ] AI show notes, chapters, clips.
- [ ] Screen-share track; RTMP live streaming.
- [ ] Bring-your-own S3; EU residency.
- [ ] First business licenses (SSO, audit logs in `/ee`).
- **Gate E (Sep 2027):** ≥ $3k MRR or ≥ 3 business licenses → double down; else keep as portfolio/open-source project.
