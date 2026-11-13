# 14 — Riverside Feature Parity (decision table)

Source: Riverside "What is Riverside" + "AI at Riverside" pages (checked 1 Nov 2026).
Goal: cover ~70% of what most Riverside users actually use, plus what Riverside can't offer (self-host, private AI, no lock-in).

## Match (expected basics)

| Riverside | Tapry | Phase |
|---|---|---|
| Local recording, separate tracks per person | Core | v1 |
| Up to 4K video, 48 kHz uncompressed WAV | Up to 4K (each camera's best; built 13 Nov 2026, not yet tried with a real 4K camera) | Built |
| Constant-frame-rate export | Yes | v1 |
| Join by link, no install | Yes | v1 |
| Audio-only mode | Yes | v1 |
| Transcripts in 100+ languages | Whisper, private | v1 |
| Up to 10 guests | 4 → 8–10 | v1 → v1.1 |
| Noise reduction, levelling | Open-source models | v1.1 (noise removal shipped early with filters, Nov 2026) |
| Video filters (brightness, looks, touch-up), background blur | Non-destructive: live in the call, applied to the files, originals kept | Built Nov 2026 (owner decision, ahead of the v1 scope guard), including background blur from a mask track; background images later |
| AI show notes, chapters, takeaways | Private AI | v1.1 |
| Studio branding | Yes | v1.1 |
| Teleprompter / notes | **Interview guide tracker** (smarter) | v1.1 |
| Collaborators | Team roles + comments | v1.1 |
| Phone guests | Mobile browser first | v1 / v1.1 |
| Screen share | Separate track | v1.2 |
| Filler/pause removal | Light, all tracks in sync | v1.2 |
| Captions | SRT/VTT | v1.2 |

## Do differently (our edge)

| Riverside | Tapry |
|---|---|
| Cloud only | Self-host or bring your own storage |
| AI in Riverside's cloud | AI on our/customer's servers |
| Edit inside Riverside | Export to any editor with aligned tracks |
| Producer mode (chat, settings) | **AI producer** (quality alerts, talk balance, guide tracking) |
| Magic Clips (viral social clips) | Quote finder + library search |
| Free: 2 h total + watermark | Self-host unlimited free; 2 h/month cloud free; $12 own storage |
| $29 for 5–15 h | $19 for 15 h, $39 for 40 h and 3 seats (pricing v4) |
| General creator tool | Templates for research, newsrooms, podcasts; consent + redaction |

## Later (after paying users)

| Riverside | Why wait |
|---|---|
| Live streaming / multistreaming | Big build → v2 |
| Native iOS/Android/Mac apps | Only if > 15–20% guests on phones |
| Scenes, layouts, intros/outros, media board | Production polish, not a switching reason |
| Publish to Spotify / podcast hosting | Integrate with hosts instead |
| Basic timeline trims | Simple only |

## Skip

| Riverside | Why |
|---|---|
| Webinars (1,000 viewers, call-ins) | Different product, heavy infrastructure |
| Full text/timeline video editor with design tools | Descript, CoProd, Riverside own this |
| AI voice, VideoDub lip-sync, eye contact | Costly, risky, off-audience |
| AI B-roll / generated media | Same |
| Translation dubbing | Same |
| Newsletters, social scheduling | Off-focus |

---

## Benchmark refresh: the field on 13 Nov 2026

Sources: the vendors' own pricing pages, read 13 Nov 2026: Riverside (riverside.com/pricing and
its product-updates pages), Descript (which now carries SquadCast as "Rooms"), StreamYard.
Zencastr's and Podcastle's pages could not be read that day (Podcastle now redirects to
async.com); what is said about them below is from third-party listings and is marked unverified.

### What each one sells

| | Riverside | Descript (Rooms) | StreamYard | Tapry today |
|---|---|---|---|---|
| Entry paid plan | Pro $29 (5 h) | Hobbyist $16–24 (5 h) | Essential $15–19 (live only) | Creator $19 (15 h) |
| Next plan | Grow $39 (15 h) | Creator $24–35 (15 h) | Core $36–45 (unlimited local) | Studio $39 (40 h, 3 seats) |
| Free | 2 h once, 720p, watermark | 2 h a month, 720p | 2 h a month, logo | 2 h a month, no watermark; self-host unlimited |
| Top video | 4K from Pro | 4K export from Creator | 4K local on Advanced ($69–89) | **1080p** |
| Audio | 48 kHz WAV | not stated | not stated | 48 kHz WAV or FLAC |
| People | up to 10 | 10 | 6–10 on screen | 8 |
| Screen share | yes | 2 at once, recorded | yes | **no** |
| Record alone / async | Business only | no | no | **no** |
| Producer (present, not recorded) | Business only | 3–10 "Control Room" producers | backstage | **no** |
| Teleprompter | host on Pro, guests on Business | no | no | **no** |
| Frame rates 24/25/29.97 | Business only | not stated | no | constant frame rate, one rate |
| Timeline export to editors | Business ("non-destructive") | Premiere, Final Cut, Audition, Pro Tools, Logic, Reaper from Creator | no | aligned files only |
| Transcripts | unlimited | 25 languages | Advanced only | yes, on your server, TXT/DOCX/SRT/VTT |
| AI notes, chapters | show notes from Pro | chapters, writing tools | no | **no** |
| AI clips | Magic Clips (free) | clip creation | AI clips from Core | **no** |
| Filler and silence removal | from Pro | yes | no | **no** |
| AI sound cleanup | "Audio enhancement" | Studio Sound | no | noise removal + loudness |
| Generative (eye contact, B-roll, avatars, voice clones, dubbing, AI twin) | yes | yes, the most | AI backgrounds | no, by decision |
| Chat-driven editing agent | Co-creator, AI Editor (Sep–Oct 2026) | Underlord | no | no, by decision |
| Live streaming, webinars | Grow $39, Webinar $99 | no | the core product | no (Later / Skip) |
| Hosting, newsletter, social scheduling | Grow | publish pages | no | no (Skip) |
| Mobile apps | iOS, Android | no | yes | desktop browsers only |
| API, MCP | API on Business, MCP on Grow | no | no | open source, no documented API |
| SSO, audit, compliance | Business (SOC 2, ISO 27001) | Enterprise | Business | planned (Business) |
| Self-host, own storage, on-server AI | no | no | no | **yes** |

Zencastr (unverified): about $18–24 entry, audio-first, hosting and ads, AI clipping.

### Reading it

1. **4K is the one headline spec we lose on.** Every paid competitor says "4K"; we say 1080p.
   In practice most webcams deliver 1080p and a browser only records 4K from a camera that
   offers it, but buyers compare the number.
2. **Screen share is the one everyday feature we lack.** All three have it.
3. **Three things Riverside keeps for its Business plan fit our buyers and are cheap for us:**
   recording alone on a link (async: research diaries, statements, remote contributors), a
   producer who is present but not recorded (newsrooms), and frame-rate choice.
4. **The AI people actually use after a recording is small:** summary, chapters, show notes,
   filler and silence removal, clips. The generative layer (avatars, dubbing, eye contact, B-roll,
   AI twin, chat-driven editing) is where Riverside and Descript now compete with each other;
   it is costly, off-audience and stays in Skip.
5. **Where nobody competes with us:** self-hosting, own storage, AI that never leaves the server,
   the consent record, live quality alerts with talk balance, the guest tech check.

### Gaps to fill, in order

Ordered by what a buyer would notice first, then by cost. Effort is a rough build estimate.

| # | Gap | What we'd build | Effort | Notes |
|---|---|---|---|---|
| 1 | 4K | Studio setting 1440p / 4K: capture at the camera's best up to the setting, ~20 Mbit/s, falls back by itself; per-person files in full resolution, combined video stays 1080p | 3–4 days | Fits the 32 Mbit/s per-person cap. Storage and processing roughly triple: on Tapry Cloud, Studio and Team plans only; free on self-host. Needs a real 4K camera to verify |
| 2 | Screen share | A screen track per person, recorded locally and uploaded like the camera, shown in the call, a file of its own and a place in the combined video | 1–1.5 weeks | Already planned (v1.2); a second video track is what the mask track proved possible |
| 3 | AI notes | Summary, chapters, show notes, key quotes with timestamps from the transcript, as editable drafts | 1 week | Local model by default (Ollama) per plan 12. The current cloud server has no GPU: there it needs a bigger machine, or an external model the account explicitly allows |
| 4 | Record alone (async) | A link where one person records answers to the host's questions with no call; same recorder, upload and processing | 4–6 days | Riverside sells this on Business only |
| 5 | Producer seat | Join a session present in the call and the controls, never recorded, not in the files | 2–3 days | |
| 6 | Timeline export | A project file (OpenTimelineIO / FCPXML / Reaper) placing every aligned track, so an editor opens the session ready | 3–4 days | "Edit anywhere" made concrete; Descript charges for it |
| 7 | Teleprompter / notes | Host's script or question list on screen during the session | 2 days | First step of the interview guide tracker |
| 8 | Filler and silence list | Detected from transcript timings and voice activity; a cut list applied to all tracks in sync, reviewed first | 1 week | Planned v1.2 |
| 9 | Frame-rate choice | 24 / 25 / 29.97 / 30 in the studio's settings, applied by the worker | 1 day | |
| 10 | Clips from quotes | Pick a transcript range, get that clip cut from the combined video | 4–5 days | Not "viral clip" generation |
| 11 | Mobile guests | Test and support iOS Safari / Android Chrome as guests | unknown until tested | Apps only if phones are >15–20% of guests |
| 12 | API and webhooks, documented | Create studios and invites, list recordings, "recording ready" webhook | 1 week | Natural for an open-source tool; Riverside gates it to Business |

Unchanged: live streaming and scenes stay in Later; webinars, hosting, newsletters, social
scheduling and all generative media stay in Skip.
