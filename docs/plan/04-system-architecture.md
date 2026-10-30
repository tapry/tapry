# 04 — System Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Web app | Next.js (App Router) + TypeScript | One codebase for studio, dashboard, marketing |
| UI | Tailwind + shadcn/ui | Fast, clean |
| Real-time call | **LiveKit** (self-hosted SFU, Apache 2.0) + LiveKit JS SDK | Mature WebRTC, TURN included, self-hostable |
| API | Next.js route handlers or a small Go/Node service | Studios, sessions, presigned uploads |
| DB | Postgres | Sessions, tracks, chunks, users |
| Queue | Redis + BullMQ (or pg-boss) | Post-processing jobs |
| Storage | S3-compatible: **MinIO** (self-host), **Cloudflare R2** (cloud, no egress fees) | Multipart uploads |
| Media worker | Node/Python + **ffmpeg** | Concatenate, normalize, render, package |
| Transcription | faster-whisper (GPU) / whisper.cpp (CPU) / optional API | Self-host friendly |
| Auth | Auth.js or Lucia-style sessions; magic link | Guests need no account |
| Billing (cloud) | Paddle or Lemon Squeezy (merchant of record) | VAT handled; check payouts to Morocco |
| Observability | OpenTelemetry + Sentry; no media in logs | — |

## Services

```
apps/web        Next.js: studio UI, dashboard, admin, marketing
apps/api        sessions, presigned multipart, webhooks (can live in web initially)
apps/worker     media pipeline (ffmpeg), transcription
packages/recorder   browser recording + OPFS + upload queue (the core library)
packages/sync       clock offset + alignment utilities
packages/shared     types, zod schemas
deploy/compose      docker-compose.yml (web, worker, postgres, redis, livekit, minio, caddy)
deploy/helm         Kubernetes chart (later)
```

`packages/recorder` should be usable standalone → potential separate OSS library (more stars, more contributors).

## Data model (first cut)

```
users(id, email, name, created_at)
workspaces(id, name, plan, owner_id)
studios(id, workspace_id, name, slug, settings_json)          -- quality, max guests, branding
sessions(id, studio_id, status, started_at, stopped_at, server_start_ts)
participants(id, session_id, display_name, role, device_info_json, clock_offset_ms)
tracks(id, participant_id, kind, mime, upload_id, status, duration_ms, size_bytes)
chunks(id, track_id, seq, start_ts, bytes, etag, uploaded_at)
outputs(id, session_id, type, storage_key, status)            -- per-track wav/mp4, combined, transcript
jobs(id, session_id, type, status, error, timings_json)
usage(workspace_id, month, recorded_minutes, storage_gb)
```

## Self-hosting
- `docker compose up` with `.env` (domain, S3, LiveKit keys).
- Caddy for automatic HTTPS (WebRTC + getUserMedia require HTTPS).
- Defaults: MinIO for storage, CPU transcription (optional), single node.
- Docs: requirements (CPU/RAM/disk per concurrent session), ports (LiveKit UDP range, TURN), backups.

## Cloud costs (estimates — measure in beta)

| Item | Estimate |
|---|---|
| Storage | 1h, 4 people @1080p ≈ 6–12 GB raw → R2 ≈ $0.015/GB-month → ~$0.10–0.20 per recording-month; compress/expire raw after N days |
| Egress | R2: no egress fees |
| LiveKit | Low-res call only → modest bandwidth; self-hosted on a VPS, or LiveKit Cloud for convenience |
| Processing | ffmpeg CPU minutes per recorded hour; GPU for Whisper (cents per hour self-run) |
| Target | Total cost < 20% of revenue per paying user |

## Security & privacy
- Media encrypted in transit (HTTPS/SRTP) and at rest (bucket encryption).
- Signed, expiring download URLs.
- Cloud region choice (EU default for EU customers).
- Delete raw chunks after outputs are verified (configurable retention).
