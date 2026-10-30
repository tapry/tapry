# 06 — Monetization

## Revenue streams (priority order)

| # | Stream | What | Price (test) |
|---|---|---|---|
| 1 | **Cloud (hosted)** | We run everything | See tiers below |
| 2 | **AI add-ons** | Transcripts beyond quota, edit-by-transcript, show notes, chapters, clips | Included quotas + usage packs |
| 3 | **Business license (self-host)** | SSO, audit logs, branding removal, priority support, compliance docs | **$1–5k/year** per org |
| 4 | **API / white-label** | Recording embedded in other platforms | Per recorded minute or monthly contract |
| 5 | Sponsors | GitHub Sponsors / Open Collective | Small |

## Cloud tiers (vs Riverside: Pro $29 for 5h, Grow $39 for 15h)

| Plan | Price | Includes |
|---|---|---|
| **Free** | $0 | 5 h/month recording, 1080p, 3 participants, 30-day retention, small "Powered by" badge |
| **Creator** | **$12/month** | 25 h/month, 4K, 6 participants, transcripts, 90-day retention, no badge |
| **Studio** | **$29/month** | 80 h/month, 8 participants, edit-by-transcript, AI show notes/clips, custom branding, 3 seats |
| **Business** | from **$99/month** | Unlimited studios, SSO, bring-your-own S3 storage, EU data residency, SLA |

Positioning: **"Riverside Pro gives 5 hours for $29. We give 80."**

## Unit economics (targets — measure in beta)

| Item | Target |
|---|---|
| Cost per recorded hour (storage 90 days + processing + call) | < $0.30 without AI, < $0.60 with transcription |
| Creator plan at full usage (25 h) | cost ~$8–15 → tune limits/retention so average usage keeps margin > 60% |
| Gross margin overall | > 70% |
| Payment/MoR fees | ~5–10% |

Levers: shorter raw-file retention, compressed archival copies, GPU batching for Whisper, storage on R2 (no egress).

## Projections (from cloud launch)

| Scenario | Paying users at month 12 | Avg revenue | MRR | + Business licenses |
|---|---|---|---|---|
| Bad | 20 | $15 | $300 | 0 |
| Base | 250 | $18 | **$4.5k** | 2 × $2k/yr |
| Good | 800 | $20 | **$16k** | 5–10 licenses |

Typical OSS reality: most self-hosters never pay; revenue comes from people who'd rather not run servers, and from businesses.

## Pricing experiments
- Annual discount (2 months free).
- Founding-member lifetime deal (limited, e.g., 200 seats) for early cash — cap usage to protect margins.
- Education/nonprofit discounts (universities = strong self-host/business segment).
