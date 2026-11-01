# 10 — Design Inspiration

Study these before designing each screen. Use Mobbin (mobbin.com) and Page Flows (pageflows.com) for real screens; Land-book, Lapa Ninja, SaaS Landing Page and Godly for landing pages.

## Landing page

| Reference | Borrow |
|---|---|
| **Cap** (cap.so) | Overall structure; light, airy look; GitHub star count in header; "switching from Loom?" CTA; two-card pricing |
| **Dub** (dub.co) | Visual polish, soft gradients, testimonial wall |
| **Screen Studio** | Hero video that **shows output quality** |
| **Cal.com**, **Plausible** | Open-source + cloud messaging; privacy/ownership tone; honest pricing page |
| **Documenso**, **Papermark**, **Formbricks** | "Open-source alternative to X" story |

### Tapry landing page structure
1. **Hero:** "The remote recording studio you own." Buttons: *Start recording free* · *Self-host*. Screenshot of the studio with "Guest joined ✓" and per-guest "98% uploaded".
2. GitHub stars in the header.
3. **Before/after:** throttled Zoom recording vs Tapry recording.
4. **"Never lose a recording":** live upload status, crash recovery, quality alerts.
5. **"Private by design":** self-host, bring your own storage, AI on your servers, consent + redaction.
6. **"Works with your tools":** Resolve, Premiere, Final Cut, Descript, NVivo, ATLAS.ti, MAXQDA, Dovetail logos (only once integrations exist).
7. Use cases: Podcasts · Research interviews · Newsrooms · Teams.
8. Testimonials → Pricing → FAQ.
9. "Switching from Riverside or SquadCast?" CTA → footer.

## Dashboard, screen by screen

| Tapry screen | References | Borrow |
|---|---|---|
| **Recordings library (home)** | Riverside, Cap, Loom, Descript, Frame.io | Tiles with participant avatars, duration, **status badge** (processing/ready/failed), hover preview, search, folders |
| **Recording detail** | Riverside, SquadCast/Descript Rooms, Mux asset page, Otter/Granola | **One row per person** with downloads; transcript beside media with clickable timestamps and speaker colours; asset metadata |
| **Upload & processing status** | **Vercel** deploy timeline, GitHub Actions, Railway | Step timeline: uploading → syncing → processing → ready; expandable steps; retry |
| **Live studio (host view)** | Riverside, Tuple, Whereby | Minimal call UI; **per-guest status chips** (recording · 98% uploaded · ⚠ clipping) |
| **Green room (guest)** | SquadCast, Riverside | Name, devices, level meter, consent checkbox, Join — nothing else |
| **Studios & invite links** | **Cal.com** event types, Whereby rooms | Cards with "copy link", settings, upcoming sessions |
| **Usage & billing** | **Supabase** usage bars, Cloudflare R2, Plausible, Linear/Vercel billing | Bars vs plan limits; calm upgrade prompt |
| **Privacy settings** (retention, AI mode, consent text, region) | Sentry/PostHog data settings, Vanta/Drata controls | Clear toggles with explanations; "what leaves your server" summary |
| **Audit log** | Sentry/PostHog audit logs, Linear | Filterable table: who, what, when |
| **Self-host admin** | **Immich** admin, **Coolify**, Supabase | Services with health dots, job queue, storage, version + "update available" |

## Overall feel
- **Linear** for calm, dense layout and keyboard shortcuts.
- **Dub / Resend** for light, clean tables and typography.
- **Raycast / Arc** for a ⌘K command palette (new studio, find recording, copy link).

**If you copy only four:** Riverside (recording pages), Vercel (processing timeline), Supabase (usage bars), Immich (self-host admin). Linear + Dub for style.
