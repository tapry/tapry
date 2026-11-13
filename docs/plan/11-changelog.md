# 11 — Changelog

# v1 (30 Oct 2026) → v2 (1 Nov 2026)

## Positioning
1. Dropped "cheaper Riverside" — Iris ($9) and Ringr ($7.99) already win on price.
2. New: **"The remote recording studio you own"** (reliability + privacy + openness).
3. First paying target moved from indie podcasters to **organisations** (research teams, universities, newsrooms, privacy-bound companies). Podcasters come via open source.
4. Marketing hooks added: "Switching from Riverside or SquadCast?" (SquadCast being replaced by Descript Rooms).

## Pricing
5. Self-hosted free forever with all core features.
6. **New $6/month bring-your-own-storage plan** with unlimited recording.
7. Creator $12 → **$9** (20 h); Studio $29 → **$19** (60 h, 3 seats).
8. Unlimited guests, no per-seat pricing below Studio.
9. Transcripts included on all plans.
10. Founding lifetime deal (~$99–149, ~200 seats, capped).
11. Flat organisation licences ($1–5k/year) + new card-payable **Research team** plan.

## Product — reliability (v1)
12. Live per-guest upload status on host screen.
13. Crash recovery as a headline feature.
14. In-call quality alerts (clipping, echo, quiet mic, low disk, upload behind, tab hidden).
15. Processing timeline UI.
16. Fast, light studio page as a principle.

## Product — privacy (v1/v1.1)
17. Consent capture per guest (moved into v1).
18. Transcripts with speaker = track (moved into v1).
19. Private AI on own servers (local model), AI mode per workspace.
20. Redaction of names/emails/phones in transcripts.
21. Retention policies, audit log, EU hosting, DPA template.

## Product — openness (v1.2)
22. Editor exports with aligned tracks (Resolve, Premiere, Final Cut, Descript, CoProd if possible).
23. Research exports (NVivo, ATLAS.ti, MAXQDA) + Dovetail integration + pseudonymised names.
24. Full editor replaced by simple cuts by transcript.
25. Embeddable recorder moved to v2 as a later revenue line.

## Removed / non-goals
26. Generative AI (B-roll, eye contact, voice cloning, dubbing, avatars, viral clips).
27. Full "open-source Descript" editor.

## Architecture
28. Telemetry path (metadata only) for live status + alerts.
29. BYO storage configs, consents, telemetry, redactions, audit log tables.
30. `packages/exports`; optional AI container in Docker Compose; admin health page.

## Go-to-market & roadmap
31. Alpha split: 10 creators + 10 researchers/journalists.
32. 10 validation interviews with research teams / university IT (Phase 2).
33. Gate C adds "≥ 50 lifetime deals"; Gate D adds "≥ 3 organisation pilots".
34. Research guides (GDPR interview recording, consent template, data-flow diagram for ethics applications).
35. Company formation planned ~Apr–May 2027 for organisation invoices.

## New file
36. `10-design-inspiration.md` — landing page and dashboard references.

## Research behind v2
- Riverside complaint themes: performance/speed 30%, stability 23% (Kimola report).
- Riverside AI feature list (17+ features) → don't compete on AI breadth.
- SquadCast status: Descript Rooms will eventually replace it (Descript FAQ).
- Research data constraints: ethics boards, GDPR special-category data, data residency (Yaps, HappyScribe).
- Universities with own tools (Aarhus Secured Video, Groningen secure transcription, Kaltura); UK CCS paid ~£25k for Dovetail because Teams recordings were inadequate.

---

# v2 → v3 (1 Nov 2026)

1. **Renamed OpenTake → Tapry** ("OpenTake" is already an open-source AI video editor on GitHub). tapry.app/.io/.studio + GitHub org free on 1 Nov 2026; .com taken. Buy tapry.app only; trademark search before launch.
2. New `12-ai-features.md`: AI producer (live quality alerts, talk balance) in v1; interview guide tracker + live notes in v1.1; search, ask-your-recordings, quote finder, research coding in v1.2; follow-up suggestions + live translation in v2. All private by default.
3. New `13-growth-features.md`: guest → host loop and free mic test/upload check at launch; referral hours, share pages, solo recorder, consent/GDPR generators, shows/series, scheduling, multi-language UI in v1.1; solo mode, imports, integrations, embeddable player, education mode in v1.2; plugin system, async interviews, Slack bot in v2.
4. New `14-riverside-parity.md`: every Riverside feature sorted into match / do differently / later / skip (skip: webinars, full editor, voice cloning, dubbing, eye contact, AI B-roll).
5. `02-product-spec.md` and `08-roadmap.md` updated with these items; Week 0 added (domain, GitHub, waitlist).
6. README: realistic first-4-months cash after launch ($3–10k total, mostly lifetime deals) added to goals.

---

# Pricing v4 (13 Nov 2026)

1. `06-monetization.md` rewritten after a pricing benchmark (new `15-pricing-benchmark.md`). The $9 / $19 plans lost money at full use on the measured costs and sat far below every metered competitor.
2. Cloud: Creator **$19** (15 h, files kept 30 days), Studio **$39** (40 h, 3 seats, 60 days), new Team **$149** (80 h, 5 seats, 90 days, EU hosting, data agreement); Own storage **$12** (was $6); Free cloud 2 h a month, files kept 7 days (was 5 h, 30 days). Hosted plans remove originals after 7 days.
3. Organisations: Business from **$4,800 a year** (was from $99 a month); self-hosted Organisation support **$2,400 a year** and licence **$6,000 a year** (was $1–5k); the separate Research team plan is folded into Team.
4. Founding offers: lifetime only for Own storage ($149, 200 seats); a price lock ($15 / $29) for the first 100 Creator or Studio subscribers.
5. Education and non-profit discount 30% (was 50%). Projections revised down for year one.
6. Carried into `00`, `01`, `07` and `08` on the same day: the Riverside "price rise" corrected (a new tier), and "lifetime deal" replaced by the founding offers.

