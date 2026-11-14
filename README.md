# Tapry

Studio-quality remote recording you can host yourself. Guests join from a link in their
browser; everyone is recorded **on their own device** at full quality, uploaded while you talk,
and turned into separate tracks you can edit. Open source, with recordings in your own storage.

> **Status: 0.2.0.** The full recording flow works and is tested end to end, including an
> hour-long two-person recording in Chromium and with Safari as the guest: nothing lost, no
> drift (see [what's tested](docs/browser-support.md)). Expect rough edges; please
> [report them](../../issues).

## What it does

- **Local recording per person.** Each guest's browser records their camera and microphone
  itself, so a shaky connection blurs the live call but never the recording.
- **Nothing lost.** Recordings are saved in the browser as they happen and uploaded in small
  pieces while you talk. A dropped connection, closed tab or crashed browser picks up where it
  left off when the guest comes back.
- **Problems shown while you record.** The host sees, per guest, a distorting, silent or too
  quiet mic, echo from speakers, an upload falling behind, low disk space or a tab sent to the
  background, and each guest gets advice for their own. Plus each person's share of the talking.
- **Guests need nothing.** A link, a browser (Chrome, Edge, Firefox, Safari), no account, no
  install. A green room checks their camera, microphone and storage first; a tech-check link
  lets them test their setup days before, and the host sees how it went.
- **Consent kept properly:** each studio sets what guests agree to; every guest's agreement is
  stored with the exact text (SHA-256) and time, in a consent record per recording.
- **Live call** alongside the recording (LiveKit), including guests behind strict firewalls
  (TURN over TLS on port 443).
- **Files ready to edit:** per person a WAV (or FLAC) and an MP4, a combined grid video with names
  on the tiles (or one mixed audio file for audio-only studios), all aligned to the moment you
  pressed Record and cut to the same length. Audio levelled to a common level for spoken audio (−16 LUFS)
  without compression. Download one by one or all as a zip; guests can download their own.
- **Transcripts** (whisper.cpp, runs on your server, 99 languages) as TXT, Word, SRT and VTT,
  labelled by speaker.
- **Easy to run:** a server health page for the admin, and a recording timeline that studios what's
  happening from Stop to files.
- **Yours:** recordings live in your S3-compatible storage (SeaweedFS included; R2, AWS,
  Backblaze work). Storage usage per studio; deleting removes the files.

## Compared to

| | Tapry | Riverside | Zoom recording |
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
git clone <this repository> tapry && cd tapry/deploy/compose
./setup.sh studio.example.com you@example.com
docker compose up -d
```

Open `https://studio.example.com`; the first account becomes the admin (the form asks for the setup code `setup.sh` printed). Requirements, ports,
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
| `apps/site` | The project's website (landing, use cases, docs, pricing, blog, free tools), a static export; not part of a self-hosted install |
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

Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Contributors sign a
[CLA](CLA.md) once.

## License

Copyright © 2026 Tapry contributors.

Tapry is free software under the [GNU Affero General Public License v3.0](LICENSE). If you
run a modified version as a service for others, you must offer them its source.
`packages/recorder` is [MIT](packages/recorder/LICENSE), so it can be used in any project.
Third-party software in the Docker images: [NOTICE.md](NOTICE.md).
