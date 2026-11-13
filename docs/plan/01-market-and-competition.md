# 01 — Market & Competition (checked Oct–Nov 2026, re-verify before launch)

## Paid cloud tools (same core function: per-guest local recording)

| Product | Price | Notes |
|---|---|---|
| **Riverside** | Free 2 h (one-time); Pro **$29/mo** (15 h on its plan card, 5 h in its own comparison table); Grow $39; Webinar $99, a separate tier; Business custom | Checked 13 Nov 2026 (`15-pricing-benchmark.md`); the "$34 → $99 rise" in plan v2 was the new Webinar tier. 17+ AI features (clips, dubbing, translation, eye contact, B-roll, AI agents, MCP). Lock-in to its editor. |
| **SquadCast** | Free to ~$80/mo | Owned by **Descript** since 2023. "Eventually Descript Rooms will replace SquadCast" — no sunset date. |
| **Descript Rooms** | Included in Descript plans (counts media minutes) | Recording inside Descript's editor |
| **Zencastr** | From ~$20/mo | Up to 12 participants |
| **Iris** | Free 1 h; **from $9/mo for 2 h** | 4K, 48 kHz, separate tracks |
| **Remotely.fm** | From $19 (audio) / $35 (video) | Auto-mixes tracks |
| **Ringr** | **From $7.99/mo** | Mobile + web |
| **Zoom / Meet / Teams** | Already paid by most orgs | Records the compressed call; "good enough" for many — the main free competitor |

**Takeaway:** we can't win by being cheapest: Zencastr's page now shows only a free plan, and StreamYard, Zoom and Cleanfeed don't meter hours. Among tools that do meter, the entry band is $15–24 a month for 5–15 h, and Iris's $9 buys 2 h. Our prices (`06`, pricing v4) sit at the low end per recorded hour; the difference we sell is ownership.

## Open-source landscape

| Project | What it is | Why it isn't Tapry |
|---|---|---|
| **Ennuicastr** | Open-source browser recorder, per-guest local recording | Audio-focused, sold as a paid hosted service, not packaged for self-hosting. **Closest OSS competitor.** |
| **VDO.Ninja** | AGPL WebRTC tool with local recording | Built for live streamers using OBS; technical URL-parameter UX; no automatic sync/exports |
| **Jitsi Meet** | Open-source meetings, self-hostable | Server-side recording of the compressed call |
| **LiveKit** | Open-source WebRTC server + SDKs (Apache 2.0) | Building block → we build on it |
| **CoProd** | Source-available (Elastic License 2.0) AI video editor for Mac | Post-production for solo creators, no remote guests → **a partner (export target), not a competitor** |

Directories of open-source podcast recorders list **no open-source Riverside equivalent**. The gap is open.

## Research and organisations (adjacent tools)

| Tool | What it does | Relationship to us |
|---|---|---|
| **Dovetail**, Great Question, Looppanel | Research repositories: upload interviews, transcribe, tag, analyse | **Integrate, don't compete.** They need clean recordings; UK Crown Commercial Service paid ~£25k for Dovetail partly because Teams recordings were inadequate. |
| **University in-house tools** (e.g., Aarhus "Secured Video", Groningen's secure transcription, Kaltura) | Universities build or license GDPR-safe recording/transcription | Confirms demand; also means some universities are already covered → **target research groups and institutions without such a tool**, and pitch self-hosting to university IT |
| NVivo, ATLAS.ti, MAXQDA | Qualitative analysis software | **Export targets** (transcripts with speakers/timestamps) |

## The 3 gaps we fill

| Gap | Evidence | Our answer |
|---|---|---|
| **Reliability** | Riverside complaints: performance/speed 30%, stability 23% (crashes, sync, lost recordings, failed uploads); 38% negative | "Never lose a recording": live per-guest upload status, crash recovery, in-call quality alerts |
| **Privacy and data control** | Ethics boards and GDPR: third-party cloud = vendor reviews, data agreements, weeks of delay; sensitive topics need safeguards | Self-hosted; **AI runs on the customer's servers**; consent capture; redaction; retention policies; EU hosting |
| **Lock-in** | Riverside/Descript push their own editor; SquadCast folded into Descript | Export to any editor with aligned tracks; bring your own storage; open source |

## Target segments (priority order)

| # | Segment | Pain | Pays? | How to reach |
|---|---|---|---|---|
| 1 | **Research teams** (academic qualitative research, UX/market research) | Ethics/GDPR block cloud tools; need consent, transcripts, speakers | **Yes**: team plan or licence | Research methods communities, university IT, ethics office guidance pages, LinkedIn |
| 2 | **Newsrooms and journalists** | Source protection, data control | Yes: organisation licence | Journalism tech communities, newsroom innovation leads |
| 3 | **Privacy-bound companies** (health, legal, HR training, EU firms) | Data residency, procurement | Yes: Business plan | LinkedIn, security/compliance angle |
| 4 | **Podcasters and YouTubers** | Riverside cost/limits, Zoom quality | Some (Creator/Studio) | Open-source launch, Reddit, SEO "Riverside/SquadCast alternative" |
| 5 | **Self-hosters** | Want to own data | Rarely — bring stars and word of mouth | r/selfhosted, awesome-selfhosted |
| 6 | **Platforms** (course, hiring, podcast hosts) | Want recording built in | Later (embeddable recorder) | After v2 |

## Positioning

- **Main:** "The remote recording studio you own."
- **For organisations:** "The interview recording studio your ethics board will approve." / "Recordings and AI that never leave your servers."
- **vs Riverside:** "Same studio quality. Your servers, your storage, any editor."
- **vs SquadCast users:** "Switching? Keep separate-track recording without being moved into someone else's editor."
- **vs Zoom:** "Each guest recorded locally in full quality, even on bad Wi-Fi."
- **vs VDO.Ninja:** "Built for interviews and podcasts, not live production. One link, done."

**Not:** "cheaper Riverside."

## Market signals to track
- Reddit/X complaints about Riverside reliability and pricing; SquadCast/Descript Rooms migration threads.
- Searches: "Riverside alternative", "SquadCast alternative", "self-hosted podcast recording", "GDPR interview recording tool".
- University ethics office guidance on recording tools (which tools they approve).
- GitHub stars of LiveKit, Cap, VDO.Ninja as audience proxies.

## Still to validate (before Gate D)
- Do research groups actually buy a separate recording tool, or do they settle for Teams/Zoom plus a transcription tool? → 10 interviews in Phase 2.
- How long is university procurement for a small licence (< €2k/year)? Can a research group pay by card?
