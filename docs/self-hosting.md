# Self-hosting Tapry

One server, Docker, four DNS names. Everything (app, database, storage, live call, HTTPS)
runs from `deploy/compose`.

## Requirements

| | Minimum | Notes |
|---|---|---|
| Server | 2 vCPU, 4 GB RAM | Processing a 1 h 1080p recording uses one core for roughly real time. More cores → faster. |
| Disk | 50 GB+ | 1 h with 4 people at 1080p ≈ 6–12 GB of chunks, plus the processed files. |
| OS | any Linux with Docker Engine + Compose v2 | Caddy and LiveKit use host networking (see below). macOS works for trying it out (OrbStack / Docker Desktop). |
| DNS | `studio.example.com`, `s3.`, `livekit.` and `turn.studio.example.com` | All four → the server's IP. |
| Ports open | TCP 80, 443, 7881 · UDP 3478, 7882 | 7881/7882: the call's audio and video. 3478/UDP and 443: TURN relay. |
| Ports closed | everything else, in particular TCP 5349 | 5349 is LiveKit's TURN behind Caddy; it needs TURN credentials but shouldn't face the internet. |

Why four names: browsers upload recordings **directly** to storage using signed URLs, and a
signed URL is only valid for the exact host it names, so storage needs its own name. LiveKit
and TURN get their own so they can have their own certificates.

### Guests on strict networks (TURN)

Most guests send call media straight to LiveKit (UDP 7882, or TCP 7881). Networks that block
that (many offices, schools, hotels) still let HTTPS out, so LiveKit's built-in TURN relay is
reachable at `turns:turn.<domain>:443`: Caddy accepts TLS for `turn.<domain>` on port 443 and
hands it to LiveKit; every other name on 443 goes to the website as usual (Caddy is built
with the `caddy-l4` plugin for this). Recording never depends on the call, so it works either way.

**Why host networking:** LiveKit's TURN relays to LiveKit's own media port, which only works
when LiveKit sends from the address it advertises. Under Docker's default bridge network it
sends from the container's address and the relay drops every packet, so the `livekit` and
`caddy` services run with `network_mode: host`. LiveKit also ignores Docker's bridge
addresses (172.16.0.0/12) for media for the same reason.

Checked with `e2e/turn.spec.ts`: a two-person call where the browsers may only use relayed
connections and TURN-over-UDP is switched off: it connects, video flows, and the browsers'
own stats show the connection as a TLS relay through `turn.<domain>:443`.

## Install

```bash
git clone <repo> tapry && cd tapry/deploy/compose
./setup.sh studio.example.com you@example.com   # writes .env with random secrets
docker compose up -d                            # first run builds the image (a few minutes)
```

Open `https://studio.example.com`. The **first account you create becomes the admin**; after
that sign-up is closed (set `ALLOW_SIGNUP=true` in `.env` to let others register).

### Using the release images instead of building

Every release publishes ready-made images (amd64 and arm64), which skips the few-minute build.
After `./setup.sh`, add to `.env` the two lines from the
[release notes](../../../releases) (`TAPRY_IMAGES=ghcr.io/…` and `TAPRY_VERSION=…`), then:

```bash
docker compose pull && docker compose up -d --no-build
```

### Try it on your own machine

```bash
./setup.sh localhost
docker compose up -d
```

Then open http://localhost. No DNS needed: browsers resolve `s3.localhost`,
`livekit.localhost` and `turn.localhost` to your machine. (Plain http is fine here because browsers treat
`localhost` as secure for camera and microphone access.)

**macOS:** if the repo lives in `~/Documents`, `~/Desktop` or `~/Downloads`, macOS asks before
OrbStack / Docker Desktop may read it. Until you allow it, Caddy hangs silently while reading its
config (no logs, nothing on port 80). Allow access, then `docker compose restart caddy`.

The web app is published on `127.0.0.1:3000` for Caddy, so stop a `pnpm dev` server on 3000
first (or the other way round).

## What runs

| Service | Image | Data |
|---|---|---|
| caddy | built from `deploy/docker/caddy.Dockerfile` (Caddy 2.11.7 + caddy-l4) | certificates in `caddy-data` |
| web | built from `deploy/docker/web.Dockerfile` | — (studio UI and API; queues processing jobs) |
| worker | same image, `node worker.cjs` | — (processes and transcribes recordings) |
| postgres | `postgres:17.11-alpine` | `postgres-data` |
| seaweedfs | `chrislusf/seaweedfs:4.51` | recordings in `seaweedfs-data` |
| livekit | `livekit/livekit-server:v1.13.11` | — |

## Even volume

Studios level everyone's audio by default ("Even out volume" in the studio's settings): each
person's WAV, the sound in their video, and the combined video's mix are brought toward
-16 LUFS, the loudness podcast apps expect. It's one fixed volume change per file, never
compression or limiting, so the recording sounds exactly as captured. Two limits keep it
honest: peaks never go above -1 dBTP (a voice with sharp peaks stays a little under -16), and
a quiet track is raised by at most 20 dB (so a mic left muted doesn't turn into hiss).

## Transcripts

On by default. Each person's audio is transcribed separately with whisper.cpp (language
detected per speaker), then merged into `Transcript.txt`, `.srt` and `.vtt` with speaker names.
They appear on the recording a little after its audio and video files.

- **Model:** the image ships Whisper `base` (multilingual, 148 MB). For better accuracy, build
  with `--build-arg WHISPER_MODEL=small --build-arg WHISPER_MODEL_SHA256=<sha>` (466 MB, ~3x slower).
- **Speed:** CPU only. `WHISPER_THREADS` (default 4) sets how many cores one transcript uses.
- **Off:** set `WHISPER_MODEL=` (empty) in `.env` and `docker compose up -d`.

## Names on the combined video

Each tile of `Combined.mp4` carries the person's name (DejaVu Sans, shipped in the image; set
`TILE_FONT` to another font file to change it). Known limit: ffmpeg's text drawing has no
right-to-left shaping, so Arabic or Hebrew names render with unjoined letters.

## Using your own S3 (R2, AWS, Backblaze…)

Delete the `seaweedfs` service, then in the `x-app-env` block at the top of
`docker-compose.yml` (shared by `web` and `worker`) set `S3_ENDPOINT` (your provider's
endpoint), `S3_PUBLIC_ENDPOINT` (remove it if it's the same), `S3_REGION`, `S3_BUCKET` and the
keys. Your provider must accept presigned `PUT`s with a signed `x-amz-checksum-sha256` header;
check with `pnpm --filter @tapry/web test:s3` pointed at it (`S3_E2E_*` variables).
The bucket also needs CORS allowing `PUT` and `GET` from your studio's origin.

## Operating

- **Update:** `git pull && docker compose up -d --build` (or, with release images, set the new
  `TAPRY_VERSION` in `.env` and `docker compose pull && docker compose up -d --no-build`).
  Database migrations run on start. Read the [changelog](../CHANGELOG.md) first.
- **Logs:** `docker compose logs -f web worker`. Logs never contain media, only ids and errors.
- **Backups:** back up the `postgres-data` and `seaweedfs-data` volumes (or `pg_dump` + your
  storage provider's replication). Recordings are useless without the database that indexes them.
- **Health:** `GET /api/health` returns `{"ok":true,"version":"0.1.0"}` when the app and its database are up.
- **Downloads:** single files come straight from storage through short-lived signed links.
  "Download all (.zip)" is put together on the fly by the web container as it streams, so
  it uses no extra disk but does pass through the web container: a 5 GB zip is 5 GB of its
  bandwidth. Zips can't be resumed if the connection drops; single files can.
- **Keeping originals:** by default the original uploads are kept next to the processed files.
  Set `RAW_RETENTION_DAYS=7` in `.env` to remove them 7 days after an episode's files are ready
  (0: right away). That saves 40–50% of the space ([costs.md](costs.md)). Once they're gone,
  the episode can't be processed again, and a guest's upload arriving after that is turned away.
  The originals are the best-quality copies: keep them if you edit from the raw video.
- **Disk space:** each studio shows how much storage its recordings use (uploaded chunks plus
  processed files). Deleting a recording or a studio removes its files from storage within
  seconds, and once more about 16 minutes later to catch uploads that were already on their way.
  Guests still uploading a deleted recording are told to stop, and their browsers discard their
  copies. Names and timestamps of deleted recordings stay in the database (no media).

## Known limits (v1)

- TURN relays the call through your server: budget bandwidth for guests who need it
  (≈ 1 Mbit/s each way per relayed guest at the call's 360p).
- Processing scales out: `WORKER_REPLICAS=3 docker compose up -d` runs three workers on the
  same queue (each job runs once). A stopped worker hands its job back; a crashed one's job is
  picked up again after `WORKER_LOCK_SECONDS` (default 10 min). Running jobs renew their lock,
  so long transcriptions are never taken over mid-way.
- One web container. Live-session updates and the sign-in lockout are held in memory, so
  scaling to several web containers needs a shared channel first (Redis / Postgres NOTIFY).

