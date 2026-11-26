# 06 — Monetization

Pricing v5 (26 Nov 2026), set after a second benchmark on 25 Nov 2026 (competitors' prices that day, how open-source products with a hosted version earn, what organisations pay, and the evidence on plan structure). It replaces v4 (13 Nov 2026, benchmark in [`15-pricing-benchmark.md`](15-pricing-benchmark.md)), whose margins left out the payment fee, AI notes and real server capacity: counted in, v4's Studio and its $29 founding price lost money at full use.

**Principle (unchanged):** don't sell on being cheapest. Be **free where it hurts competitors** (self-hosting), **the lowest price per recorded hour among metered tools** where individuals pay, and earn the real money from **organisations that need to own their recordings**. New in v5: **nothing is sold as unlimited** on our servers, because processing capacity is the cost v4 didn't count.

## Plans

Prices in USD. Yearly billing is ten months' price (2 months free). Hours are counted per recording, not per person, and start again each billing month.

| Plan | Monthly | Yearly | Hours a month | Seats | Finished files kept | Video | Also |
|---|---|---|---|---|---|---|---|
| **Self-hosted** | **Free forever** | — | Unlimited | Unlimited | As you choose | Up to 4K | Everything in the open-source release, community support |
| **Free cloud** | $0 | — | 2 | 1 | 7 days | Full HD | "Recorded with Tapry" badge; 10 hours for verified education accounts |
| **Own storage** | **$12** | $120 | **25** (was no limit) | 1 | In the customer's bucket, never deleted by us | Up to 4K | Transcripts, AI notes, no badge |
| **Creator** | **$24** (was $19) | $240 | 15 | 1 | 30 days | Full HD | Transcripts, AI notes, no badge |
| **Studio** | **$49** (was $39) | $490 | 40 | 3 | 60 days | Up to 4K | Studio branding |
| **Team** | **$149** | $1,490 | 80 | 5 | 90 days | Up to 4K | Email support (2 working days); payment by invoice on the yearly plan |
| **Business** (hosted) | — | from **$4,800** | from 120 (was unlimited) | from 10 | from 180 days | Up to 4K | Invoice and purchase order, support in 1 working day, retention settings; SSO and audit log are planned, not built |
| **Organisation support** (self-hosted) | — | **$2,400** | — | — | — | — | One installation, two named contacts, first reply in 2 working days, help with updates, compliance documents. The application only, not the customer's servers |
| **Organisation licence** (self-hosted) | — | **$6,000** | — | — | — | — | **Not sold until SSO and audit log exist** |

Where each price sits (read 25 Nov 2026): metered competitors charge $1.93 to $5.80 per included hour on monthly billing, median about $2.84 (Riverside Pro $29, Descript $24 to $65, Boomcaster $29 to $499, Iris $9 to $29). Creator at $24 is $1.60 an hour, Studio $1.23, Team $1.86. Own storage: Cap's $12 own-bucket plan is the only public reference. Team sits under Lookback's $1,782 a year and under the strictest university card limits ($3,000). Business matches Dovetail's card tier ($4,800, just under the common $5,000 card limit). Organisation support: f4's network licence is €2,199 and Nextcloud's floor about €7,100 a year (100 users at €71.29; v4 said €5,300, which is the rate from 200 users).

**On every paid plan:** the hosting region is named (EU) and the data processing agreement applies, once that document is published (`docs/legal-drafts.md`). They were Team features in v4; EU buyers treat both as entry requirements.

**Add-ons: none is built, so none is offered or shown.** Until then the way past a limit is the next plan. When built, in this order:
1. A 4K hour counts as two (see Unit economics).
2. Extra recording hours: a **10-hour pack for $25** (was $2 an hour: a $3 top-up loses a fifth to the payment fee's fixed part).
3. Extra seat: **$15 a month** on Studio and Team (was $10 and $19).
4. Keeping files longer: **$10 per 250 GB a month** (was $5 per 100 GB).
- One-off installation on the customer's server, without a subscription: **$900**. Still a first guess; change it after three jobs.

**Rules**
- Hours are counted per recording, not per person: an hour with four people is one hour. Up to 10 people in a recording, as in the software.
- Recording quality is never locked behind payment beyond 4K. Plans differ by hours, retention, seats and organisation features.
- Transcripts and AI notes are included everywhere they exist: no credits.
- Hosted plans remove the original uploads 7 days after processing and keep the finished files for the plan's retention. Not negotiable below Business.
- Education and non-profit: **20% off** Creator, Studio and Team (was 30%: at 30% Studio and Team lose money at full use; Sonix and Otter, the tools these buyers compare, give 20%). Verified education accounts still get 10 free hours a month instead of 2. Non-profits: by hand for now.
- No trial: Free is the trial for individuals; an organisation gets a 30-day Team pilot set by hand (the admin's plan setting with an end date).
- EU organisations are quoted contract prices in euros at the same figure (€2,400, €4,800, €6,000).
- No regional or purchasing-power prices at launch.
- Never sell a hosted-storage plan below $19.
- The self-hosted release never loses a feature it has.

**Headline:** "Free if you host it. $12 if you bring your storage. The lowest price per recorded hour if we host it."

## Founding offers

- **Dropped: the $149 lifetime own-storage offer.** Processing, the call relay and support run on our server for the life of the buyer, so it was never free to serve; lifetime buyers rarely upgrade (Plane: under 5%).
- **Founding price lock: the first 100 Creator or Studio subscribers pay $19 / $39 a month** (the prices the waitlist was shown), and **the first 100 Own storage subscribers $99 a year**, for as long as they stay subscribed. v4's $15 / $29 lost money at full use.

## Before anything is sold

1. **Recordings must go to metered object storage** (R2 or similar). The figures below assume $0.015 per GB-month; the live server keeps files on its own 75 GB disk, which one Creator account at full use (about 160 GB) would fill.
2. **A separate worker** before the first Team customer or about the twentieth subscriber: the live server (2 CPUs) processes roughly 130 recorded hours a month at a quarter load.
3. **New Paddle prices** for $24 / $240 and $49 / $490, added beside the existing ones and mapped in `BILLING_PRICES` and `apps/site/src/content/tiers.ts`. The existing $19 and $39 prices become the founding ones. **Nothing in Paddle is deleted.** A 20% education discount replaces the planned 30% one.
4. **Paddle is the only payment route**: Lemon Squeezy stops processing on 31 March 2027.

## Decided, not built

- **Own bucket on Studio and Team.** Storage is our largest cost and the customer's bucket removes it. `Plan.ownStorage` would become "allowed", but retention must first leave own-bucket recordings alone on plans that have `filesDays` (today only Business, which has none, is "allowed"): until that is built and tested, the plan table stays as it is.
- **Business limits** (120 hours, 10 seats, 180 days) are what is quoted. In the software Business stays "by agreement" with no limits, since each one is set by hand.
- **Invoices on Team's yearly plan** rely on Paddle's invoicing, never run live.

## Unit economics

From `docs/costs.md`: per recorded hour with 2 people, 8.2 GB of originals and 8.9 GB of finished files; storage $0.015 per GB-month; originals removed after 7 days. v5 also counts: the payment fee (Paddle, 5% + $0.50 a charge), AI notes by the outside model (about $0.10 a recorded hour when the owner opts in), and server capacity at **about $0.11 per two-person hour and $0.22 with four people** (v4: $0.02), from one 26-minute recording that took over 35 minutes on the live server and `docs/costs.md`'s assumed $0.01 per CPU-hour. **That capacity figure rests on one recording, which had five files rather than two people's four, so it is probably too high**: measure it on ten recordings before trusting the worst-case column.

Yearly price (the lowest revenue), fee taken off, every included hour recorded in Full HD, notes written for every hour:

| Plan (yearly price) | Net revenue a month | Cost, full use, 2 people | Margin | Cost, full use, 4 people | Margin | Margin at 35% use, 4 people |
|---|---|---|---|---|---|---|
| Free, 2 h | $0 | $0.34 | — | $0.68 | — | — |
| Own storage, 25 h, $120 | $9.46 | $5.25 | 45% | $8.00 | 15% | 70% |
| Creator, 15 h, $240 | $18.96 | $5.58 | 71% | $9.67 | 49% | 82% |
| Studio, 40 h, $490 | $38.75 | $20.23 | 48% | $36.46 | 6% | 67% |
| Team, 80 h, $1,490 | $117.92 | $51.14 | 57% | $94.27 | 20% | 72% |
| Business, 120 h, 180 days, $4,800 | $379.96 | $124.80 | 67% | $237.50 | 37% | 78% |

- **4K still loses on Studio.** A 4K camera stores about three times what Full HD does: a Studio account recording all 40 hours in 4K costs roughly $53 a month against $38.75. 4K stays on Studio (Riverside and Boomcaster give it on entry plans); watch stored gigabytes per account and build "a 4K hour counts as two" before any other add-on.
- Free cloud costs $0.34 to $0.68 a month per account that uses both hours: under $4 a payer at 30 free accounts per payer and a third of that use.
- Call bandwidth is not measured; LiveKit's own cloud would charge about $0.06 for a two-person hour, small beside any plan.

## Other revenue (later)
| Stream | When |
|---|---|
| Embeddable recorder (per recorded minute or monthly) | v2 |
| Sponsors (GitHub Sponsors / Open Collective) | Small, from launch. Plausible's self-hosters give about $300 a month |

## Projections (from cloud launch) — monthly recurring revenue

The chances are a judgement carried over from v4; nothing in the new evidence moves them. The amounts are about a fifth higher because of the new prices.

| Scenario | Judged chance | Month 6 | Month 12 | Month 24 | What it looks like |
|---|---|---|---|---|---|
| Low | ~50% | $0–300 | $200–700 | $500–1,500 | Stars and self-hosters, 10 to 25 subscribers, no organisation |
| Base | ~35% | $400–900 | **$2,000–3,500** | **$5,000–9,000** | 60 to 90 subscribers at $25 to $30, plus 2 or 3 organisation contracts |
| Good | ~15% | $1,500–3,000 | $7,000–12,000 | $18,000–35,000 | Ten or more organisations on Team, Business or support contracts |

Six to ten subscribers cover the running costs (assumed at $120 to $250 a month; the real figure is on invoices). About $3,000 a month net needs roughly 140 subscribers, or 80 plus eight organisation contracts: one $2,400 support contract equals eight Creator subscribers, so the first months go to organisation conversations, not to hobbyists. Holding 80 subscribers at 6% monthly churn takes about five new payers a month.

**What to test first, in order:** real storage and worker bills from ten recordings; ten research-team conversations on $1,490 and $2,400; waitlist uptake at the founding prices against $24 / $49; per-account hours, people, 4K share and gigabytes.

**Unverified in the 25 Nov benchmark:** Riverside's pricing page (it carried a staging notice and contradicted itself on hours), Zencastr's and Async's paid prices (not readable on their pages), and any figure for what buyers pay extra to own their data (none exists: ownership removes a blocker, it is not shown to command a premium).

**Reality:** most self-hosters never pay; money comes from people who don't want to run servers and from organisations.

What of this the software enforces today, and what is still missing: `docs/cloud-billing.md`.

## Not decided
- **Currency:** USD everywhere for now. EU organisations may expect EUR quotes.
- **Who takes the payments** (merchant of record, from Morocco): Paddle; see `09-risks-legal.md` and `docs/cloud-billing.md`.
- **Business and licence features** (SSO, audit log, redaction) are not built: until they are, sell Organisation support, not the licence.
- The validation interviews in `07-go-to-market.md` decide whether Team and the organisation prices hold.
