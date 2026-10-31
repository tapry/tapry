# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org); while the
version is 0.x, a minor release can change behaviour or configuration (the notes say how).

## Unreleased

### Fixed
- Firefox sent the live call's video at full camera size instead of 360p; the encoder now
  scales it down (the recording is unaffected).
- After Stop, the page could say "All of your recording is uploaded" while a recorder was
  still handing over its last piece, and stopped warning before closing the tab. Closing it
  then left that track unfinished until the person came back. It now says it's finishing.
- A call attempt that failed partway could schedule two reconnects, joining the same person
  twice so the two copies kept kicking each other out. Reconnects now go one at a time.

### Tests
- Live call tested with the host in Chromium, Firefox and WebKit (`e2e/call.spec.ts`).
- Test browsers no longer play the fake microphones through the speakers.

## 0.1.0 — first release

The complete recording flow, self-hostable with Docker Compose.

### Recording
- Studios with a reusable guest link (rotate it to revoke). Host accounts by email and
  password; the first becomes admin, then sign-up closes unless `ALLOW_SIGNUP=true`.
- Green room: camera and mic pickers, preview, level meter, headphones prompt (turns echo
  cancellation off), storage check.
- Every participant records locally (MediaRecorder: WebM VP9/VP8 + Opus, or MP4 on older
  Safari), stores each piece in IndexedDB before uploading it, and uploads straight to
  storage while recording. Survives dropped connections, closed tabs and crashes: leftovers
  upload when the guest comes back.
- Host starts and stops recording for everyone on the server clock; live upload progress per
  person.

### Live call
- LiveKit call alongside the recording (360p copies of the tracks, so the recording is never
  affected). Mute and camera-off apply to the recording too.
- TURN over TLS on port 443 for guests on strict networks.

### Files
- Per person a WAV and an MP4, a combined grid video with names on the tiles; all aligned to
  Record and cut to the same length. Rejoined guests' pieces are merged into one file.
- Audio levelled to −16 LUFS (one gain per file, no compression; studio setting).
- Transcripts with whisper.cpp (TXT, SRT, VTT, per speaker).
- Download each file, or everything as one zip (streamed, ZIP64).
- Storage usage per studio and recording. Delete a recording or a studio, files included;
  guests still uploading it are told to stop and discard their copy.

### Self-hosting
- Docker Compose stack: Caddy (HTTPS, SNI routing), web, worker (scale with
  `WORKER_REPLICAS`), Postgres, SeaweedFS, LiveKit. `./setup.sh` writes the configuration with
  random secrets. Works on a laptop at `http://localhost` too.
- Bring your own S3 (R2, AWS, Backblaze, …).

### Known limits
- One web container (live updates are held in memory).
- Zip downloads pass through the web container and can't be resumed.
- Tested browsers and what isn't tested yet: [docs/browser-support.md](docs/browser-support.md).
