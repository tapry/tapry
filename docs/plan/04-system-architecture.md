# 04 — System Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Web app | Next.js (App Router) + TypeScript | Studio, dashboard, marketing in one codebase |
| UI | Tailwind + shadcn/ui | Fast, clean; matches Cap/Dub-style design |
| Real-time call | **LiveKit** (self-hosted SFU, Apache 2.0) + JS SDK | Mature WebRTC, TURN, data channel for telemetry |
| API | Next.js route handlers (split into a service later if needed) | Studios, sessions, presigned uploads, telemetry |
| DB | Postgres | Sessions, tracks, chunks, consents, audit log |
| Queue | Redis + BullMQ (or pg-boss) | Processing jobs |
| Storage | S3-compatible: **MinIO** (self-host), **Cloudflare R2** (cloud), **customer bucket** (BYO storage) | Multipart uploads, no egress fees on R2 |
| Media worker | Node/Python + **ffmpeg** | Concatenate, normalise, align, render, export |
| Transcription | faster-whisper (GPU) / whisper.cpp (CPU) | Runs on our or customer's servers |
| Private AI | Small open-weight model served locally (e.g., via Ollama/vLLM) for summaries, chapters, redaction assist; optional external API only if workspace allows | "AI that never leaves your servers" |
| Redaction | Named-entity detection (spaCy/Presidio-style) + regex for emails/phones | Mask personal data in transcripts |
| Auth | Auth.js sessions, magic link; SSO later in `/ee` | Guests need no account |
| Billing (cloud) | Paddle or Lemon Squeezy (merchant of record) | VAT handled; **confirm payouts to Morocco** |
| Observability | OpenTelemetry + Sentry; **no media or transcript text in logs** | — |

## Services

```
apps/web            Next.js: studio UI, dashboard, admin, marketing, API routes
apps/worker         media pipeline (ffmpeg), transcription, AI, exports
packages/recorder   browser recording + OPFS + upload queue + local telemetry (MIT, standalone)
packages/sync       clock offset + alignment utilities
packages/exports    editor (FCPXML/XML), research (NVivo/ATLAS.ti/MAXQDA), subtitle formats
packages/shared     types, zod schemas
deploy/compose      docker-compose.yml (web, worker, postgres, redis, livekit, minio, caddy, optional ai)
deploy/helm         Kubernetes chart (later)
ee/                 SSO, advanced roles, admin policies (commercial license)
```

## Data model

```
users(id, email, name, created_at)
workspaces(id, name, plan, owner_id, region, storage_mode, ai_mode, retention_days)
storage_configs(id, workspace_id, endpoint, bucket, region, credentials_ref)   -- BYO storage
studios(id, workspace_id, name, slug, settings_json, consent_text)
sessions(id, studio_id, status, started_at, stopped_at, server_start_ts)
participants(id, session_id, display_name, pseudonym, role, device_info_json, clock_offset_ms)
consents(id, participant_id, text_hash, accepted_at, ip_hash, user_agent)
tracks(id, participant_id, kind, mime, upload_id, status, duration_ms, size_bytes)
chunks(id, track_id, seq, start_ts, bytes, checksum, uploaded_at)
telemetry_events(id, participant_id, type, value, ts)        -- metadata only; short retention
outputs(id, session_id, type, storage_key, status)           -- tracks, combined, transcript, exports
redactions(id, output_id, entity_type, start_ms, end_ms, status)
jobs(id, session_id, type, status, error, timings_json)
audit_log(id, workspace_id, actor_id, action, target, ts)
usage(workspace_id, month, recorded_minutes, storage_gb, ai_minutes)
```

## Self-hosting
- `docker compose up` with `.env` (domain, S3, LiveKit keys, AI on/off).
- Caddy for automatic HTTPS (required for WebRTC + getUserMedia).
- Defaults: MinIO, CPU transcription, AI container optional (GPU recommended).
- **Admin health page:** services status, job queue, storage, version + "update available" (Immich/Coolify style).
- Docs: hardware per concurrent session, ports (LiveKit UDP, TURN), backups, upgrades.
- One-click templates: Coolify, Dokploy, Railway, Unraid, TrueNAS.

## Cloud costs (estimates — measure in beta)

| Item | Estimate |
|---|---|
| Storage | 1 h, 4 people @1080p ≈ 6–12 GB raw → R2 ≈ $0.015/GB-month; expire/compress raw after N days |
| Egress | R2: none |
| LiveKit | Low-res call only; self-hosted VPS |
| Processing | ffmpeg CPU minutes; Whisper on GPU ≈ cents per recorded hour |
| Private AI | Small model on shared GPU; batch jobs |
| **BYO storage plan** | Storage cost = $0 for us → only processing + call |
| Target | < $0.30/recorded hour without AI, < $0.60 with transcription; total cost < 20–30% of revenue |

## Security & privacy
- Encryption in transit (HTTPS/SRTP) and at rest (bucket encryption).
- Signed, expiring download URLs; downloads written to audit log.
- Region choice (EU default for EU workspaces).
- Retention jobs delete raw chunks/outputs per workspace policy; deletion logged.
- AI mode per workspace: `local` (default) / `external-allowed` / `off`.
- No media, transcript text or personal data in logs or analytics.
