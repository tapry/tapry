# CLAUDE.md — Tapry (formerly OpenTake)

Read `docs/plan/00-README.md` → `02-product-spec.md` → `03-recording-architecture.md` → `04-system-architecture.md` (plan v3, 1 Nov 2026), then `docs/decisions/`, before writing code. `10-design-inspiration.md` before UI, `12-ai-features.md` before AI work, `13-growth-features.md` before growth features, `14-riverside-parity.md` before adding any "Riverside has it" feature (check it isn't in Skip).

The product was renamed from OpenTake to **Tapry** (plan v3). Some names deliberately stay `opentake`, because data lives under them: browser storage (IndexedDB `opentake-recorder`, localStorage `opentake:ticket:` / `opentake:invite:` / `opentake:devices`, Web Locks `opentake:track:`) and the Compose project, Postgres user/database and bucket. Renaming those would orphan unsent recordings or existing installs' data. `OPENTAKE_IMAGES` / `OPENTAKE_VERSION` still work as fallbacks, and releases also publish `opentake-web` / `opentake-caddy` images for older Compose files. GitHub links wait for the repo move.

## What we're building
"The remote recording studio you own." A self-hostable, open-source remote recording studio: guests join by link in the browser; each participant is recorded locally at full quality, chunks are buffered in the browser (IndexedDB) and uploaded one object per chunk during the session (our storage or, later, the customer's own bucket); the host sees live per-guest upload status and quality alerts; a worker syncs and packages per-track files, a combined video and transcripts (speaker = track). AI runs on our/the customer's servers by default. Live call via LiveKit.

Priorities, in order: **1. never lose a recording · 2. simple guest flow · 3. privacy by default · 4. openness (exports, own storage)**. First paying customers: research teams, newsrooms, privacy-bound organisations; podcasters come through the free open-source version. v1 scope guard (plan v3): reliability + guest flow + transcripts + AI producer alerts + guest tech check + 2 free tools; everything else waits for paying users.

## Stack
TypeScript monorepo (pnpm + turborepo). Next.js (App Router), Tailwind, LiveKit (server + JS SDK), Postgres (PGlite in dev), S3-compatible storage (SeaweedFS for self-host and tests, R2 cloud, customer bucket later), ffmpeg worker, whisper.cpp for transcripts, Docker Compose, Caddy.

## Where the code deliberately differs from the plan
- **Chunks are stored in IndexedDB**, not OPFS: it works in every engine we test and gives atomic writes. OPFS can come later behind the same `ChunkStore` interface.
- **One storage object per chunk**, not S3 multipart parts: `docs/decisions/0001-one-object-per-chunk.md`.
- **Jobs live in Postgres** (`FOR UPDATE SKIP LOCKED`), not Redis + BullMQ: one less service to self-host.
- **Live status and quality alerts go through the server** (SSE + `/telemetry`), not the LiveKit data channel, so they work when the call doesn't.

## Layout
```
apps/web            studio UI, dashboard, API routes, job runner (src/worker-main.ts for separate workers)
apps/worker         media pipeline (ffmpeg): chunks → aligned WAV/MP4 + combined grid; loudness; transcripts (whisper.cpp)
apps/site           the project website (landing page), static export; separate from the self-hosted app
packages/recorder   capture → MediaRecorder → local chunk store → upload queue (MIT, standalone)
packages/shared     zod schemas, types
deploy/compose      docker-compose.yml + setup.sh
docs/               plan (v2), decisions, self-hosting, browser support, costs
```
Not yet: `packages/sync`, `packages/exports`, `ee/`.

## Status against plan v3 (1 Nov 2026)
Done for v1: studios ("shows"), invite links, green room with consent checkbox, local recording with crash recovery, live per-guest upload status, AI producer quality alerts (including too quiet and echo) and talk balance, audio-only shows, live call with TURN, processing (aligned WAV/MP4, combined grid, loudness, transcripts), downloads and zip, delete and storage usage, Docker self-host, the redesign, measured sync, Gate A's 60-minute two-person run in Chromium, and with real Safari as the guest (automated, mock mic: nothing lost, no drift; the absolute Safari-to-host gap needs real devices). Open for v1: guest tech-check link, guest end screen + recap email, free mic/camera test and upload-speed check, consent text per show with a hash, processing timeline, admin health page, FLAC/DOCX exports, release 0.2.0.

## UI
- Users see **shows** and **episodes**; the API, database and code say studios and recordings. Pages live under `/shows`.
- Design tokens are in `apps/web/src/app/globals.css` (light + dark); components use the Tailwind names, never raw colors. Primitives in `src/components/ui.tsx`.
- Download links show friendly titles; the real file name is in `data-file-name` (tests read that).

## Sync
- Every timestamp a device sends is `localNow()` (`src/lib/client/clock.ts`: performance.timeOrigin + performance.now(), rounded) plus the green room's offset estimate. Never Date.now() for anything compared with the server: it jumps when the system clock is adjusted.
- Measured by `e2e/sync.spec.ts` (beeps on the real clock, skewed guest clock): ~1–5 ms between people, no drift over 60 min, nothing lost (Gate A: `E2E_SYNC_SECONDS=3600`). Device input latency (Bluetooth) isn't covered.

## Quality alerts
- Computed on each device (`src/lib/client/quality.ts`: mic peaks and RMS from the recorder's stream, the call's incoming sound for echo, upload lag, `storage.estimate`, visibility, recorder errors) and POSTed as codes to `/sessions/:id/telemetry` on change and every 3 s. Kept in memory in `LiveHub.health` and pushed in `SessionState.health`; stale after `STALE_REPORT_MS` (15 s). Metadata only: never audio, video or transcript text.
- Thresholds (tune with alpha users): clipping = more than 3 peaks ≥ −1 dBFS in 10 s; silent = below −55 dBFS for 30 s unmuted; too quiet = 5 s of talking in the last 30 s, none reaching −38 dBFS; echo = over 20 s with 5 s of the others talking, the mic's level follows the call's (correlation ≥ 0.6 at 0–300 ms, and stronger than with the mic leading by up to 600 ms, which is someone hearing their own voice back); upload behind = oldest unsent chunk over 60 s; low disk = under 1 GB of browser storage.
- Talking (voice activity) = RMS 12 dB above the noise floor (10th percentile of the last 15 s) and above −55 dBFS, carried 400 ms over word gaps. Talk balance: each device counts its own talking per recording and reports the milliseconds in telemetry; the host sees shares after 30 s of talking in all, and a nudge at 70% after 2 min.

## Processing
- Jobs live in Postgres (`jobs`, claimed with `FOR UPDATE SKIP LOCKED`). `WORKER=inprocess` (default, required with PGlite) runs them inside the web server; with Postgres, `src/worker-main.ts` (bundled to `dist-worker/worker.cjs`, the `worker` Compose service) runs them separately and the web server uses `WORKER=off`. Running jobs renew their lock; a stopped worker hands its job back; migrations take an advisory lock so web and workers can start together.
- A recording is processed once it is stopped and every track is complete; hosts can force it ("Process now").
- All outputs are aligned to the recording start and cut to its exact length.
- Audio-only shows (studio setting `audioOnly`): no camera is asked for anywhere, so the call is voice only. When an episode has no video at all (audio-only, or every camera off), the combined output is `Combined.wav` (everyone mixed, levelled as a whole) instead of `Combined.mp4`. Not enforced on the server: switching a show to audio-only affects who joins afterwards.
- Deleting (a recording, or a studio with all of its recordings) is soft for the rows and hard for the media: chunk and output rows go at once (usage drops), the recording/track rows stay with `deleted_at` so late uploads get **410 Gone**, and a `purge_recording` job deletes the stored files by prefix, then once more after presigned upload URLs have expired. Refused while recording or while a worker holds a job on it. Re-processing deletes the previous run's files.
- Loudness (studio setting `levelLoudness`, on by default): each person's WAV is measured (EBU R128 via loudnorm) and given one fixed gain toward -16 LUFS, capped by the -1 dBTP true-peak ceiling and +20 dB. No compression or limiting, so a peaky voice can land under -16. Their video's sound gets the same gain; the combined video's mix is levelled as a whole (mixed in float first).
- Zip download (`GET …/recordings/:id/zip`) is streamed by the web server from storage with client-zip: no stored zip, files stored uncompressed, exact Content-Length, ZIP64. It is the one download that passes through the web server; single files redirect to signed storage URLs.
- `RAW_RETENTION_DAYS` (off by default): a `purge_raw` job removes an episode's chunks after it's processed, only when processing is ready, every track complete and nothing queued; sets `recordings.raw_deleted_at`, after which re-processing is refused (409) and uploads get 410. Costs per recorded hour: docs/costs.md.
- Transcripts: a separate `transcribe_recording` job queued when processing succeeds. Each person's WAV is transcribed alone (speaker = track), then merged by time into TXT/SRT/VTT. Off when `WHISPER_MODEL` is unset.

## Live call
- LiveKit, one room per session, identity = participant id. Optional: no `LIVEKIT_URL` → recording works without a call.
- The call publishes **clones** of the camera/mic tracks (scaled to 360p). Never publish, constrain or stop the tracks the recorder uses.
- Mute/camera-off disable the original tracks too: muted means silent in the recording as well.
- TURN: LiveKit's built-in relay at `turns:turn.<domain>:443`, routed by SNI in Caddy (caddy-l4). LiveKit and Caddy need `network_mode: host`; LiveKit excludes Docker bridge IPs for media. `?relay=1` on a session URL forces relay-only (for testing). Test: `e2e/turn.spec.ts` against a Linux host (see docs/dev-setup.md).
- No macOS LiveKit binaries exist; the dev build is compiled from source with a CGO-free CPU-stats patch: see `docs/dev-setup.md`.

## Rules
- **Never delete a local chunk until the server has confirmed it.** Data loss is the worst bug. The one exception: 410 Gone from the API (`TrackGoneError`) means the host deleted that recording, and the queue drops the whole track locally.
- Every chunk has seq number + server-time start; uploads are idempotent (re-uploading a part is safe).
- **Media, transcript text and personal data never appear in logs, telemetry or analytics**: metadata only.
- AI defaults to local; external AI only when the workspace allows it (when AI arrives).
- Don't build a full video editor or generative AI features (non-goals in `docs/plan/02-product-spec.md`).
- All features must work on self-hosted installs (cloud-only code goes behind flags or in `/ee`).
- Keep `packages/recorder` framework-agnostic and dependency-light.
- Add a regression test for every recording/sync bug found.
- Browser support claims must match the tested matrix in `docs/browser-support.md`.

## Commands (to set up)
- `pnpm dev` — web + worker
- `pnpm test` — unit tests
- `FFMPEG_PATH=… FFPROBE_PATH=… pnpm test` — ffmpeg-backed worker/processing tests run only when ffmpeg is found
- `WEED_BIN=… LIVEKIT_BIN=… pnpm --filter @tapry/web test:e2e` (LIVEKIT_BIN optional: without it the call step is skipped, recording still tested) — Playwright, full Chromium with fake camera/mic, host + guest flow (throttled network: not yet). `E2E_SYNC_GUEST=safari` runs `e2e/sync.spec.ts` with real Safari as the guest (`e2e/safari.ts`, safaridriver; needs Safari's "Allow remote automation")
- `WEED_BIN=/path/to/weed pnpm --filter @tapry/web test:s3` — upload API against a real S3 server (SeaweedFS)
- `cd deploy/compose && ./setup.sh localhost && docker compose up -d` — full self-host stack at http://localhost (docs/self-hosting.md)
