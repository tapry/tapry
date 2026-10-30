# Open-Source Riverside — Plan (v1, 30 Oct 2026)

Working name: **OpenTake** (placeholder — check domain/trademark before launch).

**One line:** Studio-quality remote recording you can own. Open source, self-hostable, no per-seat pricing, recordings in your own storage.

**What it does:** Host sends a link → 2–8 guests join from the browser → each person's camera and mic are recorded **locally on their own device** at full quality, uploaded in chunks during the call → host gets separate tracks per person + a combined video, synced, with transcripts.

---

## Why this, why now

| Signal | Detail |
|---|---|
| Incumbent pricing pain | Riverside Pro **$29/month for 5 recording hours**; Grow $39 for 15h; top plan raised from **$34 → $99/month (Sep 2026)**. Free plan = 2 hours one-time. |
| Open-source gap | Only **Ennuicastr** (audio-focused, paid) is a direct OSS alternative. **VDO.Ninja** is free/AGPL but built for OBS live production — powerful, complex, not a simple podcast studio. |
| Proven playbook | **Cap** (open-source Loom) reached **24k GitHub stars** with OSS + hosted cloud. |
| Founder fit | The hard parts — real-time media, chunked uploads, storage, reliability — are streaming infrastructure work. |

## Goals

| Horizon | Goal |
|---|---|
| 3 months | Reliable v1: 2–4 guests, local recording, chunked upload, multitrack download. Public OSS launch. |
| 6 months | 3–5k GitHub stars, 500+ self-hosted installs, hosted cloud paid beta. |
| 12–18 months | $3–15k MRR (good case) from cloud + AI add-ons + business licenses. |

## Files

| File | Contents |
|---|---|
| `01-market-and-competition.md` | Pricing, competitors, positioning, target users |
| `02-product-spec.md` | User flows, features by phase, non-goals |
| `03-recording-architecture.md` | The hard part: local recording, chunk upload, sync, browser constraints |
| `04-system-architecture.md` | Stack, services, data model, self-host packaging, costs |
| `05-open-source-strategy.md` | License, repo, community, how to get stars |
| `06-monetization.md` | Cloud tiers, AI add-ons, licenses, unit economics, projections |
| `07-go-to-market.md` | Launch plan, channels, content |
| `08-roadmap.md` | Week-by-week plan with go/no-go gates |
| `09-risks-legal.md` | Reliability, privacy/GDPR, consent, abuse, payments from Morocco |
| `CLAUDE.md` | Build instructions for Claude Code |

## The 3 things that decide success

1. **Recordings never get lost.** Reliability is the whole product.
2. **Dead-simple guest experience.** Click link → allow camera → done. No install, no account.
3. **A great launch.** Demo video + Show HN + r/selfhosted + r/podcasting in the same week.

## Constraint
Solo founder alongside freelance work (~15–25 h/week). Choose **either** this **or** the exam grader as the main product.
