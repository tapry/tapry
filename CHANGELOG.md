# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org); while the
version is 0.x, a minor release can change behaviour or configuration (the notes say how).

## Unreleased

### Renamed to Tapry
- OpenTake is now **Tapry**: the app, website, docs, packages (`@tapry/*`) and images
  (`tapry-web`, `tapry-caddy`). Releases also publish the old `opentake-web` / `opentake-caddy`
  names for now, so an existing install updates as before.
- In `deploy/compose/.env`, `TAPRY_IMAGES` / `TAPRY_VERSION` replace `OPENTAKE_IMAGES` /
  `OPENTAKE_VERSION`; the old names still work.
- Versions before 0.2.0 were only published as `opentake-web` / `opentake-caddy`: to go back to
  one, use the Compose file from that version too.
- Nothing to migrate: browser storage, the Compose project, the database and the bucket keep their
  old names, so unsent recordings and existing data carry over.

### Gate A: an hour, two people, nothing lost
- 60-minute two-person runs: Chromium + Chromium (every beep in both files, 4.3 ms between
  people, no drift) and Chromium host + real Safari guest (every burst in Safari's file, exactly
  a second apart). Details and how to run them: `docs/browser-support.md`.

### Consent text per show
- **What guests agree to** is now a show setting (Settings tab): research teams can put their
  study's consent wording there. Empty, guests see the usual sentence.
- Each guest's agreement is kept with the exact text (by its SHA-256) and when they agreed. If
  the host changes the text while a guest has the invite open, the guest is shown the new text
  and asked again.
- Every episode has a **consent record** (a .txt: who was recorded, when each guest agreed, to
  which text), downloadable on its own and included in "Download everything".

### Processing timeline
- Each episode shows its way to the files: recorded → everyone's upload arrived → files ready →
  transcript, with when each step finished and how long it took. While it works, the running
  step says what it's doing ("Making Sam's audio (3 of 5)") with a progress bar.

### Free upload-speed check
- **Is your internet good enough to record?** `/tools/upload-speed` on every server (no account)
  measures your upload and says whether it keeps up with sound only, 720p and 1080p shows. The
  website has the same page (`/upload-speed-test`), testing against the server in
  `NEXT_PUBLIC_SPEED_TEST_URL`; that server lists the website in `SPEED_TEST_ORIGINS`.
- The public test endpoint takes at most 64 MB a minute from one address.
- The guest tech check measures upload more accurately on fast lines (growing test pieces).

### Free mic and camera test
- The website has a **mic and camera test** at `/mic-test`, no sign-up: a level meter with the
  same "sounds good" as the green room, a 5-second recording to play back, the camera's real
  resolution and frame rate, and a warning for Bluetooth headset mics. It all runs in the
  browser; nothing is sent anywhere. `NEXT_PUBLIC_SITE_URL` makes the site's canonical links
  absolute.

### Guest end screen
- Once their upload is done, guests can **download their own recording** (their audio, and their
  video with a camera) from the end screen as soon as the episode is processed. Only their own.
  A show setting, on by default.
- Set `GUEST_PROMO_URL` to show guests a "Record your own, free" link there; unset (the default),
  there is none.

### Guest tech check
- A **tech-check link** to send guests before the session (on the show page, under the invite
  link). Guests test their browser, camera, microphone, headphones, free space, connection and
  upload speed, and can record a few seconds and listen back. Nothing is recorded for the show.
- When they press Send, the host sees the results on the show page: "All good", or what to sort
  out before the session.

### Audio-only shows
- New **Audio only** choice next to Full HD and Standard (when creating a show, and in its
  settings). Nobody is asked for a camera; the invite and green room say it's sound only.
- Episodes with no video at all (an audio-only show, or everyone with their camera off) now get
  **Combined.wav**, everyone mixed and levelled together, instead of a video of empty tiles.

### AI producer: too quiet, echo and talk balance
- An **echo** alert: someone's microphone picks up the call from their speakers, so the others
  are in their recording too. Each device compares its own recorded sound with what the call
  plays it; the person who only hears their own voice come back isn't flagged.
- A **too quiet** alert: someone who talks but stays below -38 dBFS for at least 5 s of the last
  30 s. They're told how to fix it, and the host sees it next to their name.
- **Talk balance**: while recording, the host sees each person's share of the talking, and a
  nudge once they've done 70% of it (after two minutes of talking in all). Each device counts its
  own talking (voice activity on its own mic) and reports only the number.

### New look
- The app is redesigned (Onest, coral and ink; light and dark): log in, the dashboard, the guest
  invite, check-in, the studio and the end of a session.
- Studios are now called **shows** and recordings **episodes**, numbered per show ("Episode 41").
  Pages moved from `/studios` to `/shows` (old links redirect). The API paths are unchanged.
- Dashboard: shows in a sidebar with a live dot and space used; per show the numbers (episodes,
  time recorded, space, live now), episodes that open to show who is still uploading, downloads
  with friendly names, settings and space used in tabs.
- A **New show** page: name, guests per episode, video quality and sound options in one place.
- The guest invite shows the show and who invited you, and keeps retrying by itself while the host
  hasn't opened the studio yet.
- When a session ends, everyone sees their recording arriving, then "That's a wrap".
- Studio keyboard shortcuts: ⌘/Ctrl+Shift+R start or stop recording, M mute, L copy the invite link.

### Sync
- Measured: tracks line up within 1–5 ms between people over 5 minutes, with no drift, including a
  guest whose clock is 3.7 s off (`e2e/sync.spec.ts`, results in docs/browser-support.md).
- Gate A (Chromium): a 60-minute two-person recording lost nothing (all 3,601 beeps in both files,
  every file the full length) and stayed within 4.3 ms between people, no drift.
  `E2E_SYNC_SECONDS=3600` runs it; the test now waits for processing in proportion to the length.
- Recording timestamps now use the same steady clock as the clock-offset estimate. They used the
  wall clock, which jumps when the system clock is adjusted mid-session (NTP, waking from sleep).
- The "upload is behind" note compared server time with the device clock without the offset; a
  device with a wrong clock showed the wrong lag.

### In-call quality alerts
- Each person's device watches its own mic (distorting, silent for 30 s while unmuted), upload
  (more than a minute behind), storage, tab (in the background) and recorders, and reports only
  the alert codes. The host sees them next to each name in the studio, plus "Not reporting" when a
  device goes quiet for 15 s (offline, asleep, tab closed). Each person sees advice for their own.
- "No headphones" shows as a note: it's the main cause of echo. Echo itself isn't measured yet.

### Storage
- `RAW_RETENTION_DAYS` (off by default): remove each episode's original uploads that many days
  after its files are ready, keeping the processed files. Saves 40–50% of the space.
- Each person's processed video is capped at the bitrate it was recorded at (8 Mbit/s at 1080p,
  4 at 720p), so it can't come out bigger than the upload: 22% smaller on noisy footage.
- `docs/costs.md`: measured storage and CPU per recorded hour, and what it means for pricing;
  `apps/worker/scripts/cost-benchmark.sh` re-runs the measurement.

### Website
- `apps/site`: the Tapry landing page, a static site separate from the app (self-hosted servers
  don't show it). `NEXT_PUBLIC_WAITLIST_URL` turns on the cloud waitlist form.

### Tests
- Firefox and WebKit call each other (each hosting once), on top of each engine with a
  Chromium guest. The test LiveKit now sends media on the machine's network address like a
  real server, so Firefox runs with its default settings.

## 0.1.1

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
