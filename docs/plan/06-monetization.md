# 06 — Monetization

Pricing v4 (13 Nov 2026), set after the benchmark in [`15-pricing-benchmark.md`](15-pricing-benchmark.md). It replaces the $9 / $19 plans of plan v3, which lost money at full use on our own measured costs (`docs/costs.md`) and sat far below every metered competitor.

**Principle:** don't sell on being cheapest: Zencastr is now free and StreamYard, Zoom and Cleanfeed don't meter hours, so a hobbyist who wants "free" already has it. Be **free where it hurts competitors** (self-hosting), **the lowest price per recorded hour among metered tools** where individuals pay, and earn the real money from **organisations that need to own their recordings**: nobody else offers self-hosting, own storage or data residency at a public price.

## Plans

Prices in USD. Yearly billing is ten months' price (2 months free).

| Plan | Monthly | Yearly | Includes | Compared with |
|---|---|---|---|---|
| **Self-hosted** | **Free forever** | — | Everything in the open-source release, unlimited recording, transcripts on your server, community support | Nothing comparable |
| **Free cloud** | $0 | — | 2 h/month, 1 host, files kept 7 days, "Recorded with Tapry" badge | Riverside: 2 h once; Descript: 1–2 h/month; StreamYard: 2 h/month |
| **Own storage** | **$12** | $120 | Recording into your own S3/R2 bucket, no hour limit (fair use), transcripts, no badge, 1 host | Nobody sells this; Cap includes an own bucket at full price |
| **Creator** | **$19** | $190 | 15 h/month, 1 host, files kept 30 days, transcripts, no badge | Riverside Pro $29 (15 h); Boomcaster $29 (15 h); Descript $24 (5–10 h); Iris $19 (5 h) |
| **Studio** | **$39** | $390 | 40 h/month, 3 seats, video up to 4K, files kept 60 days, studio branding | Riverside Grow $39 (20 h); Boomcaster Pro $79 (30 h, 2 hosts); Descript Creator $35/person |
| **Team** | **$149** | $1,490 | 80 h/month, 5 seats, video up to 4K, files kept 90 days, EU hosting, data processing agreement, email support (2 working days) | Boomcaster Team $249 (75 h, 5 hosts); Lookback Team $1,782/yr; Condens from €6,000/yr |
| **Business** (hosted) | — | from **$4,800** | Unlimited studios, SSO, audit log, retention policies, redaction, invoice billing, priority support | Riverside Business and Descript Enterprise: quote only; Dovetail from $4,800/yr |
| **Organisation support** (self-hosted) | — | **$2,400** | For one organisation running its own server: email support (2 working days), help with updates, compliance documents (data flow, sub-processors: none) | Nextcloud from ~€5,300/yr (100 users); Matomo bundles €275–3,400 |
| **Organisation licence** (self-hosted) | — | **$6,000** | Support as above with 1-working-day response, installation and onboarding, and the `/ee` features (SSO, audit log) as they arrive | Riverside: no self-hosting at any price |

**Add-ons** (Creator and above)
- Extra recording hours: **$2 per hour** (Descript: $5).
- Extra seat: **$10/month** on Studio, **$19/month** on Team.
- Keeping files longer: **$5 per 100 GB per month** past the plan's retention.
- One-off installation on the customer's server, without a subscription: **$900**. No published benchmark exists for this; treat it as a first guess and change it after the first three jobs.

**Rules**
- Hours are counted per recording, not per person: an hour with four people is one hour. Up to 8 people in a recording, as in the software.
- Recording quality is never locked behind payment. Plans differ by hours, retention, seats and organisation features.
- Transcripts are included everywhere.
- Hosted plans remove the original uploads 7 days after processing and keep the finished files for the plan's retention. This is what makes the plans profitable (see below), so it is not negotiable below Business.
- Education and non-profit: **30% off** Creator, Studio and Team (the common level among small open-source vendors; was 50%). Built 14 Nov 2026 for education: verified accounts also get 10 free hours a month instead of 2 (`docs/cloud-billing.md`, "Education accounts"). Non-profits: by hand for now.
- Never sell a hosted-storage plan below $19.
- The self-hosted release never loses a feature it has. Paid self-hosting adds support and organisation features (SSO, audit log), which is what every comparable open-source product reserves.

**Headline:** "Free if you host it. $12 if you bring your storage. The lowest price per recorded hour if we host it."

## Founding offers (cash before revenue)

- **Founding member, own storage for life: $149 one-time, 200 seats.** Own-storage plan only, community support only. No lifetime plan with our storage and no lifetime Business: lifetime buyers rarely upgrade (Plane: under 5%) and one buyer can need the support of 25, so the offer must cost us nothing to serve. Potential: about $30k if sold out; plan on a quarter of that.
- **Founding price lock: the first 100 Creator or Studio subscribers keep $15 / $29 a month for as long as they stay subscribed.** A capped subscription, the form Documenso used (100 seats, filled in about a year).

## Unit economics

From `docs/costs.md`: per recorded hour with 2 people, 8.2 GB of originals and 8.9 GB of finished files; storage $0.015 per GB-month; processing about $0.02. Originals removed after 7 days. Call bandwidth is not measured yet, and payment fees (5–10%) come off every figure.

**4K (added 13 Nov 2026).** Studios can record up to 4K on Studio, Team, Own storage and Business
(`Plan.video4k`); Free and Creator are Full HD. A 4K camera stores about three times what Full HD
does, so the margins in the table below, measured at 1080p, do not hold for an account that
records every hour in 4K with 4K cameras: at full use Studio would cost more than it earns.
Most webcams are Full HD and are stored as Full HD, so this is the exception; watch storage per
account, and if it shows, count a 4K hour as two or sell 4K as an add-on.

| Plan | Cost at full use, 2 people | Margin (yearly price) | Cost at full use, 4 people | Margin (yearly price) | Margin at 35% use, 4 people |
|---|---|---|---|---|---|
| Free cloud, 2 h | $0.16 | — | $0.32 | — | — |
| Creator, 15 h | $2.73 | 83% | $5.47 | 65% | 88% |
| Studio, 40 h | $12.63 | 61% | $25.26 | 22% | 73% |
| Team, 80 h | $35.94 | 71% | $71.87 | 42% | 80% |
| Own storage | processing only | > 90% | processing only | > 90% | > 90% |

Every plan stays positive in its worst case (every hour used, four people in every recording, yearly price). The old Creator cost $13–15 against $9 at full use.

- Free cloud: about 32 free users per payer at 3% conversion. Even if every one used both hours, that is about $5 a payer; at a third of that use, under $2.
- Price per included hour: Creator $1.27 ($1.06 yearly), Studio $0.97 ($0.81), Team $1.86 ($1.55). Metered competitors run from $1.53 to $4.80.

## Other revenue (later)
| Stream | When |
|---|---|
| Embeddable recorder (per recorded minute or monthly) | v2 |
| Sponsors (GitHub Sponsors / Open Collective) | Small, from launch. Plausible's self-hosters give about $300 a month |

## Projections (from cloud launch, Feb 2027) — monthly recurring revenue

Revised down for the first year after the benchmark: about 1% of open-source users and about 3% of free cloud sign-ups pay, and Plausible made $400 a month after its first year.

| Scenario | Chance | Month 4 | Month 12 | Month 24 | Mix |
|---|---|---|---|---|---|
| Flop | ~50% | $0–200 | $100–500 | $300–1k | Stars, few payers |
| Base | ~35% | $200–600 | **$1.5–3k** | **$4–8k** | 60–150 cloud payers at about $20, plus 2–5 organisations |
| Good | ~15% | $1–2k | $6–10k | $15–30k | Organisations self-hosting with licences; Team plans |

Plus founding-offer cash (one-time) at launch. One organisation licence equals about 26 Creator subscribers, so the first months should go to organisation conversations, not to hobbyists.

**Reality:** most self-hosters never pay; money comes from people who don't want to run servers and from organisations.

What of this the software enforces today, and what is still missing: `docs/cloud-billing.md`.

## Not decided
- **Currency:** USD everywhere for now. EU organisations may expect EUR quotes.
- **Who takes the payments** (merchant of record, from Morocco): see `09-risks-legal.md`.
- **Business and licence features** (SSO, audit log, redaction) are not built: until they are, sell Organisation support, not the licence.
- The validation interviews in `07-go-to-market.md` decide whether Team and the organisation prices hold.
