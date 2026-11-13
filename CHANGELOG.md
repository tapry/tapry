# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org); while the
version is 0.x, a minor release can change behaviour or configuration (the notes say how).

## Unreleased

- **The app's text is set in Inter**, and all fonts (Inter, Geist, Geist Mono) are bundled from
  npm packages instead of being downloaded from Google when building. A build no longer needs
  that download, which had failed some builds.
- **The website links to the hosted app.** Built with `NEXT_PUBLIC_APP_URL`, it shows Log in
  and Get Started, the pricing page's plan buttons open each plan's checkout in the app (monthly
  or yearly), and the privacy and terms pages describe Tapry Cloud. Without the variable the
  site describes Tapry Cloud as planned, as before.
- **From a plan button to its checkout.** Someone without an account who opens a checkout is
  sent to sign up, then back to that checkout; log in and sign up take a `next` path on the same
  server only.
- **Tapry Cloud plans (off on self-hosted servers).** With `TAPRY_CLOUD=true` accounts have a
  plan (Free, Creator, Studio, Team, Business) with recording hours a month and a time finished
  files and originals are kept. Record is refused once the month's hours are used (a running
  recording is never stopped); recordings past their time are deleted, with the date shown on
  each. Settings has a Plan tab with real usage, and the admin can put an account on a plan by
  hand. A payment provider's webhook (Paddle or Lemon Squeezy) keeps subscriptions; it is
  untested against a live account. Without `TAPRY_CLOUD` nothing changes: no plans, no limits.
  Database: plan columns on `users`, `billing_events`, `recordings.keep_until` (added
  automatically on start). See docs/cloud-billing.md.
- **A new password by email.** On a server that sends email (`SMTP_HOST`), the log-in page has
  "Forgot it?": a link by email sets a new password once, within an hour, and signs every device
  out. The answer is the same whether or not the address has an account. Without email it isn't
  offered. On Tapry Cloud, new accounts also confirm their address before they can create or
  open a studio. Database: `users.email_verified_at`, `account_tokens` (added automatically).
- **Paddle fulfilment (Tapry Cloud).** Webhooks are verified with Paddle's Node SDK and mirrored
  into `billing_customers` and `billing_subscriptions` (added automatically); each account's plan
  follows its subscriptions. A scheduled cancellation no longer ends access early: the plan stays
  until Paddle reports the subscription canceled. With `BILLING_PADDLE_API_KEY` set, the Plan
  tab's "Card, invoices and cancelling" opens Paddle's customer portal for the account.
- **Paddle checkout (Tapry Cloud).** With Paddle's client token set, plans are bought on the
  server's own `/checkout/<plan>` page, by the month or the year; `BILLING_PRICES` marks yearly
  prices with `:yearly`. Paddle's script loads on that page only.
- **Members.** An account's owner can invite people from Settings, Members. They get a link
  (emailed where the server sends email, and always shown to pass on) to create their own log-in,
  even where sign-up is closed. Members see the account's studios and recordings and can create,
  host and delete; the owner keeps the plan, the storage and the member list. A member can leave,
  and the owner can remove one: they are signed out and keep an empty account. On Tapry Cloud the
  plan sets how many seats there are. Database: `users.account_id`, `account_invites` (added
  automatically).
- **Own storage.** With `STORAGE_SECRET_KEY` set, an account can connect its own S3-compatible
  bucket on the Storage page, and the sessions it opens from then on record there: uploaded
  pieces, finished files and transcripts. The secret key is stored encrypted and never shown
  again. Saving proves the server can write, read and delete in the bucket; a test upload from
  the browser then proves guests can upload (the bucket's CORS rules). A session stays in the
  bucket it was opened with, so changing or removing a bucket strands nothing. Endpoints must be
  public HTTPS addresses unless `OWN_STORAGE_ALLOW_PRIVATE=true`. On Tapry Cloud it comes with
  the new Own storage plan. Database: `storage_targets`, `sessions.storage_target_id` (added
  automatically). Unset, nothing changes.
- **New accounts are limited** to five an hour from one address where sign-up is open.
- **Tapry Cloud warns before deleting.** Where the server sends email, a host is told by email
  which recordings are within three days of their plan's date, and none is deleted until a day
  after that warning went. Database: `recordings.expiry_warned_at` (added automatically).
- **New pricing** for the planned Tapry Cloud (docs/plan/06-monetization.md, with the benchmark
  behind it in docs/plan/15-pricing-benchmark.md), shown as planned on the website.
- **Filters.** Each person can brighten their picture, pick a look (warm, cool, black & white),
  add a light touch-up and take steady noise out of their microphone, from a Filters button in
  the green room and the room. The recording itself stays untouched: filters show live in the
  call and are applied to the finished files, where the host can also process a recording again
  without them. With noise removal, the untouched sound is kept as a second file ("… (original)").
  A filter applies to a person's whole file, whenever it was switched on. "Mirror my view" only
  flips your own preview. If a filter can't be applied, the file is kept as recorded and the
  host is told. Database: `tracks.filters`, `recordings.apply_filters`, `recordings.filters_failed`
  (added automatically on start).
- **Background blur** (in Filters). The camera is still recorded untouched. The person's device
  works out where they are (MediaPipe's selfie segmenter, served by your own server, never a
  CDN) and records a small black-and-white outline next to the camera; the call sees the
  blurred background live, and the finished video is blurred from that outline. Turn it on
  before recording starts to have it in the file. If the outline is missing or doesn't cover
  the video, the file is kept unblurred and the host is told; it never holds up or costs
  anyone's files. Self-hosters: nothing to set up; the image is about 20 MB larger.
- **New logo**, "hanging tracks": separate tracks hanging from one line.

- **New design.** The app and the website follow one design: grey neutrals, a terracotta accent
  and Geist type (still served from your own server), in light and dark. Sign-in, the dashboard
  with its folding sidebar, the studio page, the guest invite and green room, the recording room
  (grid, speaker and side-by-side layouts, full screen) and the end screens are redrawn; what they
  do is unchanged. In the room, a person's row says "Saved" only once every track is complete,
  an offline or silent device says so, and level bars move only while that person speaks.
- **Dashboard.** New pages across all your studios: Recordings (with filters), a page per
  recording with a player, its files and its transcript, Studios, Guests (with their latest tech
  check), Transcripts (searchable by what was said), Storage and Settings. All read from what the
  server already stores; nothing about recording, upload or processing changed.
- Fixed: logging in could leave the button on "One moment…" and land back on the login page.
- **Website.** Use cases, self-hosting, pricing, docs (one page per topic under `/docs/<page>/`),
  resources, about, a blog, legal (draft) and a free-tools page join the landing page, with real
  content only. Pages are exported with trailing slashes, with `robots.txt`, a sitemap (needs
  `NEXT_PUBLIC_SITE_URL`) and an icon.
- CI builds the website.
- Docs: using your own S3 also means removing `web`'s `depends_on` entry for `seaweedfs`; the
  disk estimate matches docs/costs.md.

## 0.3.0 (7 November 2026)

Tapry 0.3.0: the guest recap email, a round of reliability fixes so one bad upload or a late
guest can't cost anyone their files, security limits before going public, and the app now says
studios and recordings.

### Upgrading from 0.2.x

- Set `TAPRY_IMAGES=ghcr.io/tapry` in `.env` if you use the release images: the project moved to
  github.com/tapry/tapry.
- Copy the new `deploy/compose/Caddyfile` (Caddy now passes visitors' real addresses to the app).
- Optional: `SMTP_HOST`, `SMTP_FROM` (and `SMTP_USER`, `SMTP_PASSWORD`) in `.env` turn on the recap
  email; `SETUP_TOKEN` only matters for new installs.
- Migrations run on start, as usual.

- Security, before going public:
  - **Setup code for the first account.** `setup.sh` now writes `SETUP_TOKEN` to `.env` and prints
    it; creating the first (admin) account asks for it, so nobody else can claim a new install
    first. Existing installs aren't affected (they have their admin). Without `SETUP_TOKEN` the
    first visitor still becomes admin, as before.
  - Guests' uploads are accepted for 7 days after a recording stops, within a sane amount for
    its length and at most 50 tracks per person; a track can't claim to have begun before Record.
  - Failed logins are also limited per address, and names can't contain control characters.
  - Docker: Caddy now passes each visitor's real address to the app, so per-address limits (the
    public upload-speed test, logins) apply per visitor instead of to everyone at once.
  - The media tools only read the formats browsers record (WebM, MP4).
- Reliability, after a review for ways to lose a recording:
  - One unreadable track no longer fails the recording for everyone. The rest get their files, and the
    host sees who's missing and can try again.
  - A track that finishes while the files are being made now triggers another run, instead of being
    left out with no warning.
  - Audio stays in place after a lost chunk, instead of moving earlier for the rest of the recording.
  - Joining again as someone new no longer strands what you recorded before.
  - A second tab waits instead of recording the same person twice.
  - Join waits for the clock check, a dead connection reconnects so nobody misses Record, and a
    recorder that stops by itself carries on in a new track.
- The app now says **studios** and **recordings** instead of shows and episodes, to suit podcasts,
  interviews, research and video alike. Pages moved to `/studios`; old `/shows` links redirect. New
  consent records and transcripts say "Recording 1"; files already made keep their names.
- The project moved to github.com/tapry/tapry. New release images are at `ghcr.io/tapry`: if you use
  the release images, set `TAPRY_IMAGES=ghcr.io/tapry` in `.env`. Earlier versions stay where they were.

- Recap email: guests can ask on their end screen for an email with a link to their own recording,
  sent once it's processed. Off unless you set `SMTP_HOST`, `SMTP_FROM` and `APP_URL` (Docker Compose
  sets `APP_URL` itself); see docs/self-hosting.md. Addresses are deleted once the email is sent.

## 0.2.0 (2 November 2026)

Tapry (formerly OpenTake) 0.2.0: the AI producer (live alerts for distorting, silent, too quiet
and echoing mics, plus talk balance), a guest tech check and end screen, consent text per show
with a consent record, audio-only shows, FLAC and Word exports, a processing timeline, a server
health page, and an hour-long Gate A run with nothing lost.

### Upgrading from 0.1.x
- **Back up first** (the `postgres-data` volume, or `pg_dump`). The database updates itself when
  the new version starts: new tables for consent texts, tech checks and workers, and new columns
  for the processing timeline. Nothing to run by hand.
- Use this version's Compose file (`git pull`), then `docker compose up -d --build`, or with
  release images set `TAPRY_VERSION=0.2.0` in `.env` and `docker compose pull && docker compose
  up -d --no-build`. Images are now `tapry-web` and `tapry-caddy` (the `opentake-*` names are
  still published); `OPENTAKE_IMAGES` / `OPENTAKE_VERSION` keep working.
- New settings, all optional and off by default: `GUEST_PROMO_URL`, `SPEED_TEST_ORIGINS`,
  `UPDATE_CHECK_REPO` (see `docs/self-hosting.md`).
- Guests in the middle of uploading when you update carry on: browser storage keeps its names.

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

### AI producer: too quiet, echo and talk balance
- An **echo** alert: someone's microphone picks up the call from their speakers, so the others
  are in their recording too. Each device compares its own recorded sound with what the call
  plays it; the person who only hears their own voice come back isn't flagged.
- A **too quiet** alert: someone who talks but stays below -38 dBFS for at least 5 s of the last
  30 s. They're told how to fix it, and the host sees it next to their name.
- **Talk balance**: while recording, the host sees each person's share of the talking, and a
  nudge once they've done 70% of it (after two minutes of talking in all). Each device counts its
  own talking (voice activity on its own mic) and reports only the number.

### Guest tech check
- A **tech-check link** to send guests before the session (on the show page, under the invite
  link). Guests test their browser, camera, microphone, headphones, free space, connection and
  upload speed, and can record a few seconds and listen back. Nothing is recorded for the show.
- When they press Send, the host sees the results on the show page: "All good", or what to sort
  out before the session.

### Guest end screen
- Once their upload is done, guests can **download their own recording** (their audio, and their
  video with a camera) from the end screen as soon as the episode is processed. Only their own.
  A show setting, on by default.
- Set `GUEST_PROMO_URL` to show guests a "Record your own, free" link there; unset (the default),
  there is none.

### Consent text per show
- **What guests agree to** is now a show setting (Settings tab): research teams can put their
  study's consent wording there. Empty, guests see the usual sentence.
- Each guest's agreement is kept with the exact text (by its SHA-256) and when they agreed. If
  the host changes the text while a guest has the invite open, the guest is shown the new text
  and asked again.
- Every episode has a **consent record** (a .txt: who was recorded, when each guest agreed, to
  which text), downloadable on its own and included in "Download everything".

### Audio-only shows
- New **Audio only** choice next to Full HD and Standard (when creating a show, and in its
  settings). Nobody is asked for a camera; the invite and green room say it's sound only.
- Episodes with no video at all (an audio-only show, or everyone with their camera off) now get
  **Combined.wav**, everyone mixed and levelled together, instead of a video of empty tiles.

### FLAC audio and Word transcripts
- **Audio files** setting per show: WAV (default) or **FLAC**, the same sound at about half the
  size. Applies to each person's audio and to the mix of an episode without video.
- Transcripts now also come as a **Word document** (Transcript.docx): a title, then one
  paragraph per turn with its time and the speaker in bold. Opens in Word, Pages, LibreOffice
  and Google Docs, and imports into NVivo, ATLAS.ti and MAXQDA.

### Processing timeline
- Each episode shows its way to the files: recorded → everyone's upload arrived → files ready →
  transcript, with when each step finished and how long it took. While it works, the running
  step says what it's doing ("Making Sam's audio (3 of 5)") with a progress bar.

### Server health page
- Admins have a **Server health** page (bottom of the sidebar): database, storage (really writes
  and deletes a test file), workers and their ffmpeg, the job queue and recent failures with
  their reason, transcripts, free working space, the live call (whether your browser reaches
  LiveKit, the way guests' browsers do) and the version. Each problem says what to do.
- Every worker, including the one inside the web server, now reports in every 30 seconds, so
  a stopped worker container shows up.
- `UPDATE_CHECK_REPO` turns on a check for newer releases; off by default.

### Free tools: upload speed and mic test
- **Is your internet good enough to record?** `/tools/upload-speed` on every server (no account)
  measures your upload and says whether it keeps up with sound only, 720p and 1080p shows. The
  website has the same page (`/upload-speed-test`), testing against the server in
  `NEXT_PUBLIC_SPEED_TEST_URL`; that server lists the website in `SPEED_TEST_ORIGINS`.
- The public test endpoint takes at most 64 MB a minute from one address.
- The guest tech check measures upload more accurately on fast lines (growing test pieces).
- The website has a **mic and camera test** at `/mic-test`, no sign-up: a level meter with the
  same "sounds good" as the green room, a 5-second recording to play back, the camera's real
  resolution and frame rate, and a warning for Bluetooth headset mics. It all runs in the
  browser; nothing is sent anywhere. `NEXT_PUBLIC_SITE_URL` makes the site's canonical links
  absolute.

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

### Sync and Gate A
- Measured: tracks line up within 1–5 ms between people over 5 minutes, with no drift, including a
  guest whose clock is 3.7 s off (`e2e/sync.spec.ts`, results in docs/browser-support.md).
- **Gate A**, an hour with two people: Chromium + Chromium lost nothing (all 3,601 beeps in both
  files, every file the full length) and stayed within 4.3 ms between people, no drift. With a
  real Safari guest (`E2E_SYNC_GUEST=safari`, driven by safaridriver), every one of Safari's 3,601
  bursts is in its file, exactly a second apart. `E2E_SYNC_SECONDS=3600` runs it; details in
  `docs/browser-support.md`.
- Recording timestamps now use the same steady clock as the clock-offset estimate. They used the
  wall clock, which jumps when the system clock is adjusted mid-session (NTP, waking from sleep).
- The "upload is behind" note compared server time with the device clock without the offset; a
  device with a wrong clock showed the wrong lag.

### In-call quality alerts
- Each person's device watches its own mic (distorting, silent for 30 s while unmuted), upload
  (more than a minute behind), storage, tab (in the background) and recorders, and reports only
  the alert codes. The host sees them next to each name in the studio, plus "Not reporting" when a
  device goes quiet for 15 s (offline, asleep, tab closed). Each person sees advice for their own.
- "No headphones" shows as a note: it's the main cause of echo (now also measured, above).

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
