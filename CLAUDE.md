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
apps/site           the project website (landing page), static export; separate from the self-hosted app
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

## UI
- Users see **shows** and **episodes**; the API, database and code say studios and recordings. Pages live under `/shows`.
- Design tokens are in `apps/web/src/app/globals.css` (light + dark); components use the Tailwind names, never raw colors. Primitives in `src/components/ui.tsx`.
- Download links show friendly titles; the real file name is in `data-file-name` (tests read that).

## Processing
- Jobs live in Postgres (`jobs`, claimed with `FOR UPDATE SKIP LOCKED`). `WORKER=inprocess` (default, required with PGlite) runs them inside the web server; with Postgres, `src/worker-main.ts` (bundled to `dist-worker/worker.cjs`, the `worker` Compose service) runs them separately and the web server uses `WORKER=off`. Running jobs renew their lock; a stopped worker hands its job back; migrations take an advisory lock so web and workers can start together.
- A recording is processed once it is stopped and every track is complete; hosts can force it ("Process now").
- All outputs are aligned to the recording start and cut to its exact length.
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
