# Tapry — Plan v3 (1 Nov 2026)

**Name:** Tapry (pronounced "tap-ree"). Domain to buy: **tapry.app**. GitHub org: **tapry**. (Checked 1 Nov 2026: .app, .io, .studio and GitHub free; .com taken. Do a trademark search before launch.)

**One line:** The remote recording studio you own. Every guest recorded locally in full quality, never lost, stored where you choose, with private AI that keeps interviews on track and makes them searchable.

**Tagline:** "Tapry — the recording studio you own."

**What it does:** Host sends a link → 2–8 guests join from the browser (no install, no account) → each person is recorded **on their own device** at full quality and uploaded in chunks during the call → an **AI producer** watches quality and the interview guide live → host gets synced per-person tracks, a combined video, transcripts, summaries and searchable quotes, ready for any editor.

**How people use it:** in the browser. Guests click a link. Hosts sign up on tapry.app. Only organisations that self-host use Docker, once, on their own server.

---

## What changed in v3

| Area | v2 | v3 |
|---|---|---|
| Name | OpenTake (taken by an open-source AI video editor) | **Tapry** |
| AI | Transcripts, summaries, redaction | **AI producer** (live alerts, talk balance, interview guide tracker), search + ask your recordings, research coding, quote finder, follow-up suggestions — all private by default → `12-ai-features.md` |
| Growth | Launch + SEO pages | **Growth loops** (guest → host, referral hours, share pages), **free no-signup tools** (mic test, solo recorder, transcript, consent form), solo mode, imports, self-host app stores, multi-language → `13-growth-features.md` |
| Riverside | Positioning only | **Feature-by-feature decision**: match / do differently / later / skip → `14-riverside-parity.md` |

Full list: `11-changelog.md`.

## Why this, why now

| Signal | Detail |
|---|---|
| Proof people pay | Riverside, Zencastr, Iris, Remotely.fm, Ringr charge for per-guest local recording; **Descript bought SquadCast** |
| Incumbents creating openings | SquadCast → Descript Rooms (no sunset date yet); Riverside top plan **$34 → $99 (Sep 2026)** |
| Reliability pain | Riverside complaints: **performance/speed 30%**, **stability 23%** (crashes, sync, lost recordings, failed uploads) |
| Privacy pain | Ethics boards + GDPR make cloud recording of interviews slow; some universities build or buy their own tools |
| Open-source gap | No polished, self-hostable Riverside (Ennuicastr audio-only, VDO.Ninja for OBS, Jitsi records the compressed call) |
| Proven playbook | **Cap** (open-source Loom): 24k+ stars, open source + paid cloud |
| Founder fit | Real-time media, chunked uploads, storage, reliability = streaming infrastructure skills |

## Goals

| Horizon | Goal |
|---|---|
| 2 weeks | Technical prototype passes Gate A (zero loss, < 50 ms sync, Chrome + Safari) |
| 3 months | Reliable v1 + AI producer alerts + free tools; open-source launch late Jan 2027 |
| 4 months after launch | Realistic cash: **$3–10k total** (mostly lifetime deals), $200–1k MRR; 1–5k stars |
| 6 months | Paid cloud, 3 organisation pilots, 30+ paying users |
| 12–18 months | $3–15k MRR (good case) |

## Files

| File | Contents |
|---|---|
| `01-market-and-competition.md` | Competitors, pricing, gaps, segments, positioning |
| `02-product-spec.md` | Flows and features by phase |
| `03-recording-architecture.md` | Local recording, upload, sync, recovery, live telemetry |
| `04-system-architecture.md` | Stack, services, data model, private AI, self-hosting, costs |
| `05-open-source-strategy.md` | License, repo, community, stars |
| `06-monetization.md` | Plans (pricing v4), organisation licences, founding offers, projections |
| `07-go-to-market.md` | Positioning, launch week, organisation sales |
| `08-roadmap.md` | Week-by-week plan with go/no-go gates |
| `09-risks-legal.md` | Reliability, privacy, consent, ethics, payments from Morocco |
| `10-design-inspiration.md` | Landing page + dashboard references |
| `11-changelog.md` | v1 → v2 → v3 changes |
| `12-ai-features.md` | **New:** AI producer, private AI, models, costs, phases |
| `13-growth-features.md` | **New:** growth loops, free tools, retention, integrations, ecosystem |
| `14-riverside-parity.md` | **New:** every Riverside feature → match / differ / later / skip |
| `15-pricing-benchmark.md` | Competitor, open-source and organisation prices behind pricing v4 (13 Nov 2026) |
| `CLAUDE.md` | Build instructions for Claude Code |

## The 4 things that decide success

1. **Recordings never get lost.** Reliability is the product.
2. **Dead-simple guest flow** (< 30 seconds) — and every guest sees Tapry at its best (growth loop).
3. **Private AI that helps during the interview**, not just after (AI producer, guide tracker).
4. **A great launch** with an audience built in public beforehand (waitlist → lifetime deals).

## Scope guard
v1 = reliability + guest flow + transcripts + AI producer alerts + guest tech check + 2 free tools. Everything else waits for paying users. Freelancing pays the bills meanwhile.

## Next actions (this week)
1. Buy **tapry.app**; create GitHub org **tapry**; grab @tapry on X/LinkedIn; quick trademark search.
2. Start **Phase 0 (2 Nov)**: recorder prototype → Gate A by 15 Nov.
3. Put up a one-page waitlist on tapry.app and start posting the build on LinkedIn/X (2–3 posts/week).
