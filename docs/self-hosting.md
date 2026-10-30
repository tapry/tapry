# Self-hosting OpenTake

One server, Docker, three DNS names. Everything (app, database, storage, live call, HTTPS)
runs from `deploy/compose`.

## Requirements

| | Minimum | Notes |
|---|---|---|
| Server | 2 vCPU, 4 GB RAM | Processing a 1 h 1080p recording uses one core for roughly real time. More cores → faster. |
| Disk | 50 GB+ | 1 h with 4 people at 1080p ≈ 6–12 GB of chunks, plus the processed files. |
| OS | any Linux with Docker Engine + Compose v2 | macOS works for trying it out (OrbStack / Docker Desktop). |
| DNS | `studio.example.com`, `s3.studio.example.com`, `livekit.studio.example.com` | All three → the server's IP. |
| Ports | TCP 80, 443, 7881 · UDP 443, 7882 | 7881/7882 carry the live call's audio and video. |

Why three names: browsers upload recordings **directly** to storage using signed URLs, and a
signed URL is only valid for the exact host it names, so storage needs its own name. LiveKit
gets one too so it can have its own certificate.

## Install

```bash
git clone <repo> opentake && cd opentake/deploy/compose
./setup.sh studio.example.com you@example.com   # writes .env with random secrets
docker compose up -d                            # first run builds the image (a few minutes)
```

Open `https://studio.example.com`. The **first account you create becomes the admin**; after
that sign-up is closed (set `ALLOW_SIGNUP=true` in `.env` to let others register).

### Try it on your own machine

```bash
./setup.sh localhost
docker compose up -d
```

Then open http://localhost. No DNS needed: browsers resolve `s3.localhost` and
`livekit.localhost` to your machine. (Plain http is fine here because browsers treat
`localhost` as secure for camera and microphone access.)

**macOS:** if the repo lives in `~/Documents`, `~/Desktop` or `~/Downloads`, macOS asks before
OrbStack / Docker Desktop may read it. Until you allow it, Caddy hangs silently while reading its
config (no logs, nothing on port 80). Allow access, then `docker compose restart caddy`.

## What runs

| Service | Image | Data |
|---|---|---|
| caddy | `caddy:2.11.7-alpine` | certificates in `caddy-data` |
| web | built from `deploy/docker/web.Dockerfile` | — (also runs recording processing with ffmpeg) |
| postgres | `postgres:17.11-alpine` | `postgres-data` |
| seaweedfs | `chrislusf/seaweedfs:4.51` | recordings in `seaweedfs-data` |
| livekit | `livekit/livekit-server:v1.13.11` | — |

## Transcripts

On by default. Each person's audio is transcribed separately with whisper.cpp (language
detected per speaker), then merged into `Transcript.txt`, `.srt` and `.vtt` with speaker names.
They appear on the recording a little after its audio and video files.

- **Model:** the image ships Whisper `base` (multilingual, 148 MB). For better accuracy, build
  with `--build-arg WHISPER_MODEL=small --build-arg WHISPER_MODEL_SHA256=<sha>` (466 MB, ~3x slower).
- **Speed:** CPU only. `WHISPER_THREADS` (default 4) sets how many cores one transcript uses.
- **Off:** set `WHISPER_MODEL=` (empty) in `.env` and `docker compose up -d`.

## Using your own S3 (R2, AWS, Backblaze…)

Delete the `seaweedfs` service, then in the `web` service set `S3_ENDPOINT` (your provider's
endpoint), `S3_PUBLIC_ENDPOINT` (remove it if it's the same), `S3_REGION`, `S3_BUCKET` and the
keys. Your provider must accept presigned `PUT`s with a signed `x-amz-checksum-sha256` header;
check with `pnpm --filter @opentake/web test:s3` pointed at it (`S3_E2E_*` variables).
The bucket also needs CORS allowing `PUT` and `GET` from your studio's origin.

## Operating

- **Update:** `git pull && docker compose up -d --build`. Database migrations run on start.
- **Logs:** `docker compose logs -f web`. Logs never contain media, only ids and errors.
- **Backups:** back up the `postgres-data` and `seaweedfs-data` volumes (or `pg_dump` + your
  storage provider's replication). Recordings are useless without the database that indexes them.
- **Health:** `GET /api/health` returns `{"ok":true}` when the app and its database are up.

## Known limits (v1)

- One web container. Live-session updates and the sign-in lockout are held in memory, so
  scaling to several web containers needs a shared channel first (Redis / Postgres NOTIFY).
- Recording processing runs inside the web container. A separate worker container is planned.
- The live call needs UDP 7882 reachable. Guests behind strict firewalls fall back to TCP 7881;
  a TURN server for the strictest networks is not configured yet. Recording never depends on
  the call, so it still works for them.
