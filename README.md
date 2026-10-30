# OpenTake

Studio-quality remote recording you can host yourself. Guests join from a link in their
browser; everyone is recorded **on their own device** at full quality, uploaded while you talk,
and turned into separate tracks you can edit. Open source, with recordings in your own storage.

> **Status: 0.1.0, first release.** The full recording flow works and is tested end to end
> (see [what's tested](docs/browser-support.md)). Expect rough edges; please
> [report them](../../issues).

## What it does

- **Local recording per person.** Each guest's browser records their camera and microphone
  itself, so a shaky connection blurs the live call but never the recording.
- **Nothing lost.** Recordings are saved in the browser as they happen and uploaded in small
  pieces while you talk. A dropped connection, closed tab or crashed browser picks up where it
  left off when the guest comes back.
- **Guests need nothing.** A link, a browser (Chrome, Edge, Firefox, Safari), no account, no
  install. A green room checks their camera, microphone and storage first.
- **Live call** alongside the recording (LiveKit), including guests behind strict firewalls
  (TURN over TLS on port 443).
- **Files ready to edit:** per person a WAV and an MP4, a combined grid video with names on the
  tiles, all aligned to the moment you pressed Record and cut to the same length. Audio levelled
  to podcast loudness (−16 LUFS) without compression. Download one by one or all as a zip.
- **Transcripts** (whisper.cpp, runs on your server, 99 languages) as TXT, SRT and VTT, labelled
  by speaker.
- **Yours:** recordings live in your S3-compatible storage (SeaweedFS included; R2, AWS,
  Backblaze work). Storage usage per studio; deleting removes the files.

## Compared to

| | OpenTake | Riverside | Zoom recording |
|---|---|---|---|
| Records each person locally at full quality | ✅ | ✅ | ❌ (records the call) |
| Separate track per person | ✅ | ✅ | audio only, call quality |
| Survives connection drops without losing audio | ✅ | ✅ | ❌ |
| Self-hosted, your storage | ✅ | ❌ | ❌ |
| Open source | ✅ AGPL-3.0 | ❌ | ❌ |
| Transcripts on your own server | ✅ | cloud | cloud |
| Cost | your server | subscription | subscription |

## Install

On a server with Docker and a domain pointing at it:

```bash
git clone <this repository> opentake && cd opentake/deploy/compose
./setup.sh studio.example.com you@example.com
docker compose up -d
```

Open `https://studio.example.com`; the first account becomes the admin. Requirements, ports,
using your own S3, updating and backups: **[docs/self-hosting.md](docs/self-hosting.md)**.

To try it on your own machine: `./setup.sh localhost && docker compose up -d`, then open
http://localhost.

## How it works

The browser records with MediaRecorder in short timeslices, writes each piece to IndexedDB
before anything else, and uploads it straight to storage through a signed URL. A piece is
deleted locally only after the server has confirmed it. When a recording stops and every
piece has arrived, a worker (ffmpeg) stitches each person's pieces together, aligns everyone
to the server clock, renders the files and transcribes them.

More: [recording architecture](docs/plan/03-recording-architecture.md),
[system architecture](docs/plan/04-system-architecture.md), [decisions](docs/decisions/).

## Repository

| Path | What |
|---|---|
| `apps/web` | Studio UI, API, job queue, standalone worker entry (Next.js) |
| `apps/worker` | Media pipeline: ffmpeg rendering, loudness, whisper.cpp transcripts |
| `packages/recorder` | Browser recording core: capture → durable local chunks → resumable upload (MIT, usable on its own) |
| `packages/shared` | Schemas and types shared by the browser and the server |
| `deploy/` | Docker images and the Compose stack |
| `docs/` | Self-hosting, development setup, browser support, plan and decisions |

## Develop

Node 22 and pnpm. Details, including how to run the end-to-end tests with real storage and
LiveKit: **[docs/dev-setup.md](docs/dev-setup.md)**.

```bash
pnpm install
pnpm dev     # http://localhost:3000
pnpm test
```

Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright © 2026 OpenTake contributors.

OpenTake is free software under the [GNU Affero General Public License v3.0](LICENSE). If you
run a modified version as a service for others, you must offer them its source.
`packages/recorder` is [MIT](packages/recorder/LICENSE), so it can be used in any project.
Third-party software in the Docker images: [NOTICE.md](NOTICE.md).
