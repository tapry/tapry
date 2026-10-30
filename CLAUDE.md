# CLAUDE.md — OpenTake (open-source Riverside)

Read `docs/plan/00-README.md` → `docs/plan/02-product-spec.md` → `docs/plan/03-recording-architecture.md` → `docs/plan/04-system-architecture.md`, then `docs/decisions/` before writing code.

## What we're building
A self-hostable, open-source remote recording studio. Guests join via link in the browser; each participant is recorded locally at high quality, chunks are buffered locally (IndexedDB) and uploaded one object per chunk during the session; a worker syncs and packages per-track files, a combined video, and transcripts. Live call via LiveKit.

## Stack
TypeScript monorepo (pnpm + turborepo). Next.js (App Router), Tailwind, shadcn/ui, LiveKit (server + JS SDK), Postgres, Redis + BullMQ, S3-compatible storage (SeaweedFS for tests, self-host default undecided (docs/decisions/0002), R2 cloud), ffmpeg worker, faster-whisper/whisper.cpp for transcripts, Docker Compose for self-hosting, Caddy for HTTPS.

## Layout
```
apps/web            studio UI, dashboard, API routes
apps/worker         media pipeline (ffmpeg): chunks → aligned WAV/MP4 + combined grid; transcripts (whisper.cpp)
packages/recorder   capture → MediaRecorder → local chunk store → upload queue (MIT, standalone)
packages/sync       clock offset estimation + alignment helpers
packages/shared     zod schemas, types
deploy/compose      docker-compose.yml + .env.example
docs/               self-hosting, architecture, browser support
```

## Build order (MVP)
1. `packages/recorder`: capture, codec detection, timeslice chunks, durable local write, per-chunk upload with retry, crash recovery. Unit + browser tests.
2. Chunk upload API (presign PUT / commit / complete) against MinIO — see `docs/decisions/0001-one-object-per-chunk.md`.
3. Studio + session model; host Record/Stop broadcast (LiveKit data channel or server events) with server timestamp.
4. Green room (device pickers, level meter, storage estimate, headphones prompt).
5. LiveKit call (low-res, audio) alongside local recording.
6. Worker: concat → CFR normalize → loudness normalize → align (timestamps + audio cross-correlation) → outputs (WAV/MP4 per track, grid video, zip).
7. Dashboard: sessions, upload/processing status, downloads, delete.
8. Docker Compose self-host + docs.
9. Test matrix automation where possible (Playwright with fake media devices; network throttling).

## Processing
- Jobs live in Postgres (`jobs`, claimed with `FOR UPDATE SKIP LOCKED`); `WORKER=inprocess` (default) runs them inside the web server, required with PGlite (single-process). A standalone worker CLI for Postgres deployments is still to do.
- A recording is processed once it is stopped and every track is complete; hosts can force it ("Process now").
- All outputs are aligned to the recording start and cut to its exact length.
- Transcripts: a separate `transcribe_recording` job queued when processing succeeds. Each person's WAV is transcribed alone (speaker = track), then merged by time into TXT/SRT/VTT. Off when `WHISPER_MODEL` is unset.

## Live call
- LiveKit, one room per session, identity = participant id. Optional: no `LIVEKIT_URL` → recording works without a call.
- The call publishes **clones** of the camera/mic tracks (scaled to 360p). Never publish, constrain or stop the tracks the recorder uses.
- Mute/camera-off disable the original tracks too: muted means silent in the recording as well.
- TURN: LiveKit's built-in relay at `turns:turn.<domain>:443`, routed by SNI in Caddy (caddy-l4). LiveKit and Caddy need `network_mode: host`; LiveKit excludes Docker bridge IPs for media. `?relay=1` on a session URL forces relay-only (for testing). Test: `e2e/turn.spec.ts` against a Linux host (see docs/dev-setup.md).
- No macOS LiveKit binaries exist; the dev build is compiled from source with a CGO-free CPU-stats patch: see `docs/dev-setup.md`.

## Rules
- **Never delete a local chunk until the server has confirmed it.** Data loss is the worst bug.
- Every chunk has seq number + server-time start; uploads are idempotent (re-uploading a part is safe).
- Media never appears in logs or analytics; only metadata.
- All features must work on self-hosted installs (cloud-only code goes behind flags or in `/ee`).
- Keep `packages/recorder` framework-agnostic and dependency-light.
- Add a regression test for every recording/sync bug found.
- Browser support claims must match the tested matrix in `docs/browser-support.md`.

## Commands (to set up)
- `pnpm dev` — web + worker
- `pnpm test` — unit tests
- `FFMPEG_PATH=… FFPROBE_PATH=… pnpm test` — ffmpeg-backed worker/processing tests run only when ffmpeg is found
- `WEED_BIN=… LIVEKIT_BIN=… pnpm --filter @opentake/web test:e2e` (LIVEKIT_BIN optional: without it the call step is skipped, recording still tested) — Playwright, full Chromium with fake camera/mic, host + guest flow (throttled network: not yet)
- `WEED_BIN=/path/to/weed pnpm --filter @opentake/web test:s3` — upload API against a real S3 server (SeaweedFS)
- `cd deploy/compose && ./setup.sh localhost && docker compose up -d` — full self-host stack at http://localhost (docs/self-hosting.md)
