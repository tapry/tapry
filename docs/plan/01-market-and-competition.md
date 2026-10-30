# 01 — Market & Competition

## Incumbent pricing (checked Oct 2026 — re-verify on vendor sites)

| Product | Plans | Notes |
|---|---|---|
| **Riverside** | Free: 2h separate-track recording (one-time), 720p, watermark. **Pro $29/mo** ($24 annual): 5h/month, 4K. **Grow $39/mo**: 15h/month. **Webinar $99/mo**. Business: custom (SSO, API, SOC 2) | Top plan raised $34 → $99 in Sep 2026 |
| **StreamYard** | Paid plans for live streaming + recording | Now owned by Bending Spoons (known for price increases) — verify |
| **Zencastr** | Paid podcast recording + hosting | — |
| **SquadCast** | Part of Descript | Bundled with Descript editing |
| **Zoom / Meet / Teams** | Cloud recordings are compressed, single mixed track | "Good enough" for many — our main free competitor |

## Open-source landscape

| Project | What it is | Gap |
|---|---|---|
| **Ennuicastr** | Web-based audio recorder (Opus/FLAC), "open source, but paid" | Audio-focused, small, little visibility |
| **VDO.Ninja** | Free AGPL WebRTC tool for bringing remote guests into OBS; has recording options | Built for live producers; complex URL-parameter UX; not a podcast studio |
| **Jitsi Meet** | Open-source meetings; server-side recording (Jibri) | Records the mixed, compressed call — not per-guest local quality |
| **LiveKit** | Open-source WebRTC server + SDKs (Apache 2.0) | Building block, not a product → we build on it |

**Gap:** no polished, simple, self-hostable "Riverside": local per-guest recording + automatic upload + multitrack + transcripts.

## Target users

| Segment | Pain | Pays? |
|---|---|---|
| **Indie podcasters / YouTubers** (interview shows) | $29 for 5h/month; Zoom quality is bad | Yes, if cheaper/more hours |
| **Privacy-sensitive orgs** (EU companies, universities, newsrooms, legal, health) | Recordings on US SaaS; procurement/GDPR | **Yes — business license / self-host** |
| **Companies** (webinars, internal shows, customer interviews) | Per-seat pricing, branding | Yes (team plan) |
| **Platforms** (podcast hosts, course platforms, hiring tools) | Want recording built in | Yes (API/white-label) — later |
| **Self-hosters / homelab** | Want to own data | Rarely pay — they bring stars and word of mouth |

## Positioning

- **vs Riverside:** "Unlimited recording on your own server. Generous cloud hours. No per-seat pricing."
- **vs Zoom:** "Each guest recorded locally in studio quality — even on bad Wi-Fi."
- **vs VDO.Ninja:** "Built for podcasts, not live production. One link, done."

## Market signals to track
- Riverside / StreamYard pricing complaints (Reddit r/podcasting, r/podcast, X).
- Search volume: "Riverside alternative", "free Riverside alternative", "self-hosted podcast recording".
- GitHub stars of adjacent repos (LiveKit, Cap, VDO.Ninja) as audience proxies.
