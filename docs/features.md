# Tapry: everything that's built

State on 15 November 2026 (live version `0.3.0-4b98dc6`, last tagged release `0.3.0`).

Tapry is a remote recording studio you can host yourself. Guests join by link in the browser,
each person is recorded on their own device at full quality, and the pieces upload during the
session. Afterwards a worker turns them into per-person files, a combined video and
transcripts.

Everything below works on a self-hosted server unless it says **Tapry Cloud**. The last
section lists what has been tested and what hasn't.

## Contents

1. [Recording](#1-recording)
2. [The guest's side](#2-the-guests-side)
3. [The host's side during a session](#3-the-hosts-side-during-a-session)
4. [Live call](#4-live-call)
5. [Picture and sound options](#5-picture-and-sound-options)
6. [Processing: the files you get](#6-processing-the-files-you-get)
7. [Transcripts and AI notes](#7-transcripts-and-ai-notes)
8. [After the recording](#8-after-the-recording)
9. [Dashboard](#9-dashboard)
10. [Studio settings](#10-studio-settings)
11. [Accounts, members and roles](#11-accounts-members-and-roles)
12. [Privacy, consent and security](#12-privacy-consent-and-security)
13. [Storage](#13-storage)
14. [Integrations](#14-integrations)
15. [Self-hosting and operations](#15-self-hosting-and-operations)
16. [Tapry Cloud](#16-tapry-cloud)
17. [The website and free tools](#17-the-website-and-free-tools)
18. [Look and feel](#18-look-and-feel)
19. [What's tested, and what isn't](#19-whats-tested-and-what-isnt)
20. [Not built](#20-not-built)

---

## 1. Recording

- **Local recording per person.** Each device records its own camera and microphone at full
  quality, independent of the call's quality.
- **Uploads during the session.** The recording is cut into chunks, kept in the browser
  (IndexedDB) and uploaded one object per chunk while the session runs.
- **A chunk is never deleted locally until the server confirms it.** Uploads can be repeated
  safely.
- **Crash and drop recovery.** A closed tab, a crashed browser or lost internet doesn't lose
  what was recorded: unsent chunks upload when the person comes back.
- **A recorder that stops by itself restarts** as a new piece (up to 5 times); processing
  joins the pieces.
- **One tab per session**, so nobody is recorded twice.
- **Reconnects by itself** if the connection to the server goes silent for 45 s, so a guest
  doesn't miss Record.
- **Sync.** Every device times its recording against the server's clock; measured at 1–5 ms
  between people with no drift over 60 minutes.
- **Up to 10 people** per recording (host and nine guests).
- **Video quality**: 720p, 1080p, or each camera's best up to 4K.
- **Frame rate** per studio.
- **Audio-only studios**: no camera asked for anywhere.
- **Screen sharing**, recorded as its own track and file.
- **Solo links**: a link someone opens to record by themselves, without a host or a call, with
  a prompt and a time limit.
- **Markers**: the host marks moments while recording (up to 500).

## 2. The guest's side

- **Join by link**, no account and nothing to install.
- **Green room**: camera and microphone check, device choice, clock check, name.
- **Tech-check link** the host sends beforehand: camera, mic, headphones, measured upload
  speed against what the studio needs, and a 5-second test recording played back locally. The
  guest chooses whether to send the result to the host.
- **Consent text** shown before joining; the guest agrees to the exact text.
- **Six languages** for the pages a guest opens: English, French, Spanish, German, Portuguese,
  Arabic (right-to-left), with a language picker. The default consent text is translated too.
- **Phones**: the screen stays awake while recording or uploading; buttons and fields are
  sized for touch.
- **End screen**: upload progress until it's done, then the guest's own files to download
  (a studio setting, on by default).
- **"Email me a link"** to their files once ready, where the server sends email. Never sent
  unasked; the address is removed after sending.
- **The studio's branding** (accent colour and logo) on the pages guests open.

## 3. The host's side during a session

- **Live upload status per guest**: how much each person has recorded and uploaded.
- **Quality alerts**, worked out on each device and sent as codes only:
  clipping, silent microphone, too quiet, echo, upload falling behind, low disk space,
  tab in the background, recorder errors.
- **"Not recording yet"** when someone's device hasn't started 20 s after Record.
- **"Not reporting"** when a device stops sending its status, never a stale "all good".
- **Talk balance**: each person's share of the talking, with a nudge when one person passes
  70%.
- **Microphone indicator on every tile**: on, speaking, muted. Speaking is measured from the
  sound itself, for your own mic and for each person you hear.
- **Producer role**: a host who joins without being recorded.
- **Guide panel**: the studio's running order or questions, visible to hosts only.
- **Keyboard shortcuts** and a full-screen view.
- **Invite link and tech-check link** on the studio page; a new invite link retires the old
  one.
- **Calendar invite** (.ics) for a session, made in the browser.

## 4. Live call

- **LiveKit**, one room per session. Optional: without it, recording still works.
- The call sends **copies** of the camera and mic, scaled to 360p; the recorder's tracks are
  never touched by the call.
- **Mute and camera-off apply to the recording too.**
- **TURN relay** built in, on port 443, for networks that block direct media.
- Screen sharing in the call (one person at a time).

## 5. Picture and sound options

Chosen by each person; the recorder always keeps the original.

- **Brightness**, **looks** (warm, cool, mono), **touch-up**.
- **Noise removal**; the untouched audio is kept as a second file.
- **Background blur**: the person is found on the device, the outline steadied between
  frames; a mask is recorded beside the camera so the finished file is blurred the same way.
- **Mirror my view** (local only).
- **Chat**: text messages between everyone in the session, through the server (works without the call), with an unread count. In memory only until the session ends: never stored, logged or recorded.
- Filters apply live in the call and in the finished files, from the moment they are switched on to the moment they are switched off (blur included). The host can process again with
  or without them while the originals are kept.

## 6. Processing: the files you get

- **Per person**: aligned audio (WAV or FLAC) and video (MP4), all starting at the recording's
  start and cut to its exact length.
- **Combined video** (1920×1080): everyone side by side, or **following the speaker** (studio
  setting). A shared screen fills the frame with the sharer's camera in the corner.
- **Combined audio** instead, when nobody had a camera.
- **Names on the combined video** (studio setting), in Inter, with a fallback font for other
  scripts.
- **The studio's logo** on the combined video.
- **Loudness levelling** toward −16 LUFS per person, with a true-peak ceiling; no compression.
- **4K**: each person's file at the size their camera really delivered, never upscaled.
- **One unreadable track doesn't cost everyone their files**: the rest are made, the host sees
  who is missing and can try again.
- **A track that arrives late** triggers a new render by itself.
- **A chunk missing from the middle** becomes silence; what follows stays in place.
- **Processing timeline**: recorded → uploaded → files ready → transcript, with live progress.
- **"Process now"** to force processing before every upload has finished.
- **Downloads**: single files by signed link, or everything as a streamed zip.

## 7. Transcripts and AI notes

- **Transcripts** with whisper.cpp on the server: each person is transcribed alone, so the
  speaker is always known. Formats: TXT, DOCX, SRT, VTT.
- **AI notes** (`Notes.md`): summary, chapters, key points, quotes, show notes.
  - A **local model** (Ollama) is used whenever one is set up; nothing leaves the server.
  - An **outside model** (Claude) is used only if the account's owner switched that on.
  - Otherwise no notes are written and nothing is sent anywhere.
- **Share-safe transcript**: speakers renamed, emails, links, phone numbers and listed terms
  masked, with a preview of counts. Text only; never stored.
- **Research exports**: NVivo and MAXQDA / ATLAS.ti formats.

## 8. After the recording

- **Clips**: cut from the combined video, frame-exact. Wide, **square** or **vertical**, with
  optional **captions** drawn from the transcript.
- **Timeline exports**: OpenTimelineIO, Final Cut Pro XML and REAPER projects that reference
  the per-person files, with the markers.
- **Pauses removed** in those timelines: silences over 2 s are cut on every track at once,
  without rendering anything.
- **Share page and embed** for a recording (off by default), with the transcript if the host
  ticks it. A new link or switching off kills the old one.
- **Comments** on a recording.
- **Consent record** per recording: who was recorded, when each guest agreed, and to which
  text. Included in the zip.

## 9. Dashboard

- **Recordings** across all studios, with a page per recording.
- **Studios**, **Guests** (with an email and notes per guest), **Transcripts**, **Storage**,
  **Usage** (hours and recordings per month), **Settings**.
- **Studio templates** when creating a studio: Blank, Podcast, Research interview, Newsroom
  interview, Class.
- **Tech-check results** from guests on the studio page.
- **Delete** a recording or a studio; storage figures drop at once.

## 10. Studio settings

Video quality · frame rate · audio-only · audio format (WAV/FLAC) · loudness levelling ·
combined video layout (side by side / follows the speaker) · names on the combined video ·
consent text · guest downloads · guide · solo link, prompt and time limit · branding (accent,
logo, logo on video) · delete recordings after N days.

## 11. Accounts, members and roles

- **Accounts** with an owner and **members** invited by email link.
- **Viewer role**: can read, comment and download the share-safe transcript, nothing else.
- **Activity log** for the owner (names of things, never content), a year, with CSV export.
- **Profile pictures.**
- **By email**, where the server sends email: forgotten password, confirming the address.
- **First account** protected by a setup code; sign-up and log-in are rate limited.

## 12. Privacy, consent and security

- **Media, transcript text and personal data never appear in logs or telemetry.**
- **No third-party fonts, analytics or trackers** in the app; fonts are bundled.
- **AI is local by default**; outside AI only when the owner allows it.
- **Consent** kept per guest by the hash of the exact text they saw; texts are never edited
  or deleted afterwards.
- **Update check is off** unless switched on.
- **Limits on what a guest's token can do**: uploads close 7 days after Stop, caps on tracks
  and bytes per person.
- **Uploaded media is read only as WebM or MP4** by ffmpeg.
- **Webhook and own-storage addresses must be public HTTPS**; redirects refused.
- Logos and avatars accepted by file signature only, never SVG.

## 13. Storage

- **Any S3-compatible storage**: SeaweedFS in the self-host stack, R2 on Tapry Cloud.
- **Own storage**: an account connects its own bucket; recordings and outputs go there.
  Secret keys are encrypted; the bucket is tested from the server and from the browser before
  it's used. A session stays with the storage it opened on.
- **Deleting** removes the media for real, and late uploads for a deleted recording are
  refused and dropped on the device.
- **Keeping time**: originals can be removed N days after processing (`RAW_RETENTION_DAYS`);
  a studio can delete recordings after N days.

## 14. Integrations

- **API keys** (`tpk_…`): read everything a member can; a documented set of write calls.
  See `docs/api.md`.
- **Webhooks**: `recording.ready` and `recording.transcribed`, signed, retried up to 8 times.
- **Email** through any SMTP server.

## 15. Self-hosting and operations

- **Docker Compose** stack with one setup script: web, worker, Postgres, SeaweedFS, LiveKit,
  Caddy with automatic HTTPS.
- **Jobs in Postgres**: no Redis. Workers can run inside the web server or separately.
- **Admin health page**: database, storage, workers, job queue, transcripts, working space,
  the call, version.
- **Backup script** for the database and configuration, with a restore check.
- Documentation: self-hosting, browser support, costs per recorded hour, development setup.

## 16. Tapry Cloud

Off unless `TAPRY_CLOUD=true`; a self-hosted server has no plans and no limits.

- **Plans** with recording hours per month, keeping time, seats, 4K, branding, AI notes and
  own storage. The only refusal is before pressing Record: a running recording is never
  stopped and an upload is never refused over a plan.
- **Expiry** with a warning email 3 days before; nothing is deleted unwarned.
- **Paddle billing**: checkout, webhooks, customer portal. Built, **currently switched off**.
- **Waitlist** in its place: paid plans say "Opening soon".
- **Education accounts**: 10 free hours a month and a discount; verified at once for academic
  addresses, otherwise approved by the admin.
- **Admin tools**: set plans by hand, see the waitlist, approve education requests.

## 17. The website and free tools

`tapry.app`, a static site separate from the app: landing page, use cases, pricing,
self-hosting, education, docs, legal, about.

Free tools, all running in the visitor's browser:

- **Mic & camera test**
- **Upload-speed test**
- **Solo recorder**
- **Consent form generator**
- **Recording data map**

## 18. Look and feel

- **Light, dark or system** appearance, chosen per person.
- Warm light theme, zinc dark theme, terracotta accent; Inter for text, Geist Mono for timers
  and figures.
- Everything on screen comes from real state: no placeholder numbers or meters.

---

## 19. What's tested, and what isn't

**Tested**

- Unit and server tests across the monorepo, including the worker against real ffmpeg.
- End-to-end in Chromium with fake camera and mic: host and guest flow, recovery, sync, call,
  screen sharing, phones, languages, 4K.
- Upload API against a real S3 server.
- A 60-minute two-person run with nothing lost and no drift, in Chromium and with real Safari
  as the guest.
- Own storage against a second SeaweedFS standing in for a customer's bucket.
- Email delivery on the live server.

**Not yet tried for real**

- Real phones, real 4K cameras, Bluetooth microphones.
- Screen sharing in Firefox and Safari.
- Own storage on Amazon S3, R2 or Backblaze B2.
- AI notes written by a real model: the prompt's quality is unjudged.
- Speaker-following video, blur, noise removal and the speaking indicator were tuned on
  synthetic sound and test patterns, not on real voices and faces.
- NVivo and MAXQDA imports; Final Cut and REAPER timelines (only OTIO was loaded by a real
  library).
- Paddle with a live token; the education discount.
- The guest translations are unreviewed.
- Sessions with real guests on bad networks.

**Known test flakiness**: three or four timing-sensitive end-to-end tests (tech-check upload
speed, 4K file length, Firefox call size, upload-speed page) fail when the whole suite runs on
a loaded machine and pass alone.

## 20. Not built

- Extra hours and longer keeping as paid add-ons.
- SSO and audit log for Business (labelled planned).
- Background images; intro/outro and name-and-title lower thirds; filler-word removal.
- Webinars, live streaming, a full video editor, generative AI features (deliberately out of
  scope: `docs/plan/14-riverside-parity.md`, `docs/plan/02-product-spec.md`).
- Published legal texts (drafts in `docs/legal-drafts.md`).
