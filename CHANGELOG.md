# Changelog

All notable changes. Versions follow [semantic versioning](https://semver.org); while the
version is 0.x, a minor release can change behaviour or configuration (the notes say how).

## Unreleased

- **The studio room is a little smaller on computers** (drawn at 90%), so the stage, the
  recording card and the people panel fit a laptop screen better. Phones and tablets keep
  full size.

- **Background blur: a steadier, tighter outline.** The outline of the person is steadied
  from frame to frame, so still edges stop shimmering while real movement is followed at once,
  and its edge sits a little tighter, so no sharp band of the room shows round the person.

- **Fix: a zoomed-in picture in 4K studios.** A camera without 4K could answer a 4K studio
  with a 4:3 mode cut from the middle of its sensor, which looked zoomed in the call and in
  the file. It is now asked again for its largest widescreen size.

- **Education accounts (Tapry Cloud).** A verified education account records 10 hours a month
  on the Free plan instead of 2, and the checkout applies the education discount (30%) where
  one is set up (`BILLING_PADDLE_EDUCATION_DISCOUNT`). An account whose owner has a confirmed
  address on an academic domain is verified when it asks (Settings, Plan); any other school's
  request waits for an admin. Nothing of this exists on a self-hosted server, which has no
  limits to lift.
- **Class template.** A new studio can start from Class: its solo link is switched on with an
  assignment, so students record alone without accounts, and recordings delete themselves
  after 120 days.
- Website: a page for teaching and research (`/education`).

- **Studio templates.** A new studio can start from Podcast, Research interview or Newsroom
  interview: each fills in the options, a guide to follow in the session and, for research, a
  consent text. Everything stays changeable.
- **Guest contacts and notes.** On the Guests page, keep an email address and notes about a
  guest (under the name they record with). Only your account sees them.
- **Activity log as CSV** for the account's owner (Settings, Members).

- **Research exports.** A transcript can be downloaded in the layouts research software
  imports, one entry per turn with its speaker and time: tab-delimited for NVivo (Timespan,
  Speaker, Content), and the f4 layout MAXQDA and ATLAS.ti read. Beside the share-safe
  transcript, so the same file can have names replaced and contact details masked. The
  layouts follow each program's documentation; none has been imported into the real program.
- **Profile pictures** for hosts and members (Settings, Account): shown in the dashboard, in
  the members list and to guests on the invite. Cropped and shrunk in the browser before
  upload; PNG, JPEG or WebP.
- **The rest of the guest room is translated**: filters, the room's buttons, the end screen's
  upload card, the own-files list and the recap email form.

- **Studio branding.** A studio can show its own logo and accent colour on the pages its
  guests open: the invite, the tech check, the green room, the solo link and shared
  recordings (studio settings, Branding). The dashboard keeps Tapry's look. Logos are PNG,
  JPEG or WebP up to 512 KB, kept in the database. On Tapry Cloud this is part of Studio and up.
- **Guest pages in six languages.** The invite, tech check, solo link, green room, the room as
  a guest sees it and the end screen follow the guest's browser language, or the one they pick:
  English, French, Spanish, German, Portuguese, Arabic (right to left). The default consent
  text is in the guest's language, and that exact text is what is kept with their consent; a
  studio's own consent text is shown as written. Hosts' pages, and what hosts are sent, stay
  English. The translations have not been reviewed by native speakers.
- **Guests on phones.** The room keeps the screen on while a session runs and until the upload
  is done, stage buttons are thumb-sized on touch screens, form fields no longer make iOS zoom,
  and wording says "this device". Tested at a phone's size in Chromium, not on real phones.
- **Usage page.** Recordings, recorded time, guests and transcripts, in all and month by month
  (`GET /api/usage`).
- **Recording data map** (website, `/data-map`): a plain record of what your recordings
  collect, where they go and how long they stay, for GDPR and ethics reviews. Runs in the page.

- **API keys and webhooks.** The account's owner makes API keys (Settings, Account): the app's
  own API for your scripts, with a key instead of a log-in. A key reads what members read and
  changes studios and recordings; never the plan, members, storage, keys, or hosting. Webhooks
  send a signed message when a recording's files or transcript are ready. See `docs/api.md`.
- **Share pages.** A recording can have a public page with its player, and its transcript if
  you choose, for anyone holding the link; and code to embed the player. Off until turned on;
  switching it off, making a new link or deleting the recording kills the old link.
- **Calendar invite.** "Schedule a session" on a studio makes a calendar file with the invite
  link and the tech-check link.

- **Timelines with long pauses left out.** Beside each timeline export there is a version
  where stretches with nobody speaking for two seconds or more (by the transcript) are cut,
  every track at the same place. Nothing is rendered or deleted: the cuts are in the project
  file, and markers move with what they mark.
- **Clips.** Cut a stretch of a finished recording (a second to ten minutes) out of the
  combined video, or the mix, as a file of its own. Times are typed or taken from the transcript.
- **Share-safe transcripts.** A copy of a transcript with speakers renamed Speaker 1, 2…,
  and email addresses, phone numbers, links and the words you list masked, in TXT, DOCX, SRT
  or VTT. Made on request and never stored. Text only: sound and picture are untouched.
- **Viewer role.** A member can be a viewer: they see, listen, download and comment, and every
  other change is refused. Given with the invitation, changed by the owner.
- **Comments** on a recording, optionally at a moment of it, by anyone in the account.
- **Activity log** for the account's owner (Settings, Members): who changed or downloaded what,
  and when, kept a year.
- **A studio's own keeping time.** "Delete recordings after 7 / 30 / 90 / 180 / 365 days", on
  any server. On a self-hosted server only this setting ever deletes a recording by date.

- **Two more free tools on the website.** `/recorder`: record your voice (and camera) in the
  browser and save the file to your own computer; nothing is uploaded. `/consent-form`: a
  plain-language recording consent form from a few answers, to copy or save.

- **Solo links.** A studio can have a link where one person records alone, with no host and no
  call: they see your questions, agree to be recorded, and start and stop it themselves (up to
  30 minutes). Each one arrives as a recording of the studio. Off until you turn it on in the
  studio's settings; 10 an hour per address.
- **Producer seat.** A host can join as producer: in the call and at the controls, never
  recorded and not in the files.
- **Guide and markers.** A studio's guide (run of show) is the host's plan, one question or
  segment per line; hosts see it beside the call and tick items off. A tick during a recording,
  or the Mark button, sets a marker at that moment. Guests never receive the guide.
- **Timeline exports.** Each finished recording has project files that lay its files out on a
  timeline with its markers: OpenTimelineIO, Final Cut XML and REAPER. On the recording's page
  and in the zip. The OpenTimelineIO file is checked against the OpenTimelineIO library; the
  other two have not been opened in their editors yet.
- **Frame rate.** A studio's video files can be 30, 29.97, 25 or 24 frames a second.

- **A backup script.** `deploy/compose/backup.sh` dumps the database, checks the dump can be
  read back, keeps a copy of `.env`, and removes backups older than 14 days. The self-hosting
  guide says how to schedule and restore it, and what it doesn't cover (the recordings' media).

- **AI notes.** A summary, chapters with times, key points, quotes and show notes, written from
  each recording's transcript and saved as `Notes.md` (a draft to edit; also in the zip and on
  the recording's page, where it can be written again). Off unless the server has a model:
  `AI_NOTES_LOCAL_URL` + `AI_NOTES_LOCAL_MODEL` use a model on your own server through Ollama
  (nothing leaves it); `ANTHROPIC_API_KEY` uses Claude, only for accounts whose owner switches
  it on in Settings, Account, and then the transcript text (never sound or picture) is sent to
  Anthropic. On Tapry Cloud the outside model is part of the paid plans. Not yet run against a
  real model.

- **Screen sharing.** Anyone in a session (on a computer) can share a screen or window. The
  others see it as the big tile in the call; while a recording runs it is recorded on the
  sharer's device as a track of its own, picture only, and uploaded like the camera. Each person
  who shared gets "<name> - screen.mp4" (1080p, black while nothing was shared), and the
  combined video shows the screen across the frame, with the sharer's camera in a corner, for as
  long as it was shared. One person shares at a time. Tested in Chromium.

- **4K.** A studio's video quality can be "4K": each person's camera is recorded at its own
  best, up to 3840×2160 (24 Mbit/s; 1440p cameras at 14). Nothing is upscaled: a Full HD webcam
  in a 4K studio is a Full HD file at Full HD's size. Per-person files keep the camera's size;
  the combined video stays 1080p. The per-person upload cap is now 48 Mbit/s. On Tapry Cloud 4K
  is part of the Studio, Team, Own storage and Business plans; a self-hosted server has no such
  limit. Not yet tried with a real 4K camera.

- **Updating from 0.3 or earlier: add `DATA_NAME=opentake` to `.env` before you update.** The
  Compose project, database and bucket are now named by `DATA_NAME` (`tapry` for new installs);
  Compose refuses to start without it, so existing data is never left behind. `OPENTAKE_IMAGES`
  and `OPENTAKE_VERSION` are no longer read, and releases no longer publish `opentake-*` images.
- **The old name is gone from browsers too, without losing anything.** Saved tickets, device
  choices and filters are written as `tapry:…` and still read from `opentake:…`; a browser that
  already has the `opentake-recorder` database keeps using it (it may hold chunks not yet
  uploaded), a new one gets `tapry-recorder`.
- **A waitlist for paid plans (Tapry Cloud).** While Paddle isn't set up, the website's plan
  buttons take an email address and the plan asked about (`POST /api/waitlist`, kept on the
  server, 5 an hour per address). The admin sees, copies and removes addresses in Settings, Plan.
- **The website knows whether you're signed in.** It asks the app yes or no
  (`GET /api/auth/status`, readable only by `SITE_ORIGINS`) and shows Open Studio in place of
  Log in and Get Started.
- **Security headers** from the bundled Caddy (HSTS, nosniff, referrer policy, no framing of the
  app) and on the website.

- **The app's text is set in Inter**, and all fonts (Inter, Geist, Geist Mono) are bundled from
  npm packages instead of being downloaded from Google when building. A build no longer needs
  that download, which had failed some builds.
- **The website links to the hosted app.** Built with `NEXT_PUBLIC_APP_URL`, it shows Log in
  and Get Started, the pricing page's plan buttons open each plan's checkout in the app (monthly
  or yearly), and the privacy and terms pages describe Tapry Cloud. Without the variable the
  site describes Tapry Cloud as planned, as before.
- **Prices in the visitor's currency.** The website's pricing page asks Paddle for each plan's
  price (`@paddle/paddle-js`, `PricePreview`), with Paddle finding the visitor's country, and
  shows Paddle's totals exactly as formatted. Plans, texts and price ids are edited in
  `apps/site/src/content/tiers.ts`. The checkout is Paddle's one-page overlay and lands on
  `/welcome`, which waits for the payment to be confirmed.
- **The Paddle environment is required.** `BILLING_PADDLE_ENVIRONMENT` (production or sandbox)
  replaces `BILLING_PADDLE_SANDBOX`; with a Paddle token or API key and no environment, or one
  that doesn't match the token, the server refuses to start. The website's build does the same
  with `NEXT_PUBLIC_PADDLE_ENVIRONMENT`.
- **Paddle's payment-link page** at `/pay`: Paddle sends people there from invoices and its "update your card" emails, and it opens the right checkout. Set it as the default payment link in Paddle.
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
