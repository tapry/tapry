# 05 — Open-Source Strategy

## License
- **AGPL-3.0** for the core (same approach as Cap, Cal.com, Plausible): anyone can self-host; companies that modify and offer it as a service must open their changes → encourages buying a commercial license.
- **`/ee` folder** (enterprise features: SSO, audit logs, advanced roles) under a commercial license, free to read, paid to use in production.
- `packages/recorder` under **MIT** (to maximize adoption as a library → stars + contributors).
- Contributor License Agreement (CLA) or DCO so you can dual-license.

## Repo setup (day 1)
- README: 20-second demo GIF/video at top, one-command install, feature list, comparison table vs Riverside/Zoom, roadmap link, cloud waitlist link.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue templates (bug, feature, browser report), labels (`good first issue`, `help wanted`, `browser:safari`).
- GitHub Discussions + Discord.
- Public roadmap (GitHub Projects).
- Releases with changelogs; Docker images on GHCR.

## How to get stars (what actually works)
1. **Demo video that shows the magic:** throttle Wi-Fi → live call gets blurry → final recording is crisp.
2. **Launch week, same 48 hours:** Show HN, r/selfhosted, r/podcasting, r/opensource, X/Twitter thread, Product Hunt, LinkedIn.
3. **Technical blog post:** "How we record each guest locally in the browser and never lose a file" (OPFS, multipart, sync). HN loves deep technical posts.
4. **Comparison pages:** "Riverside alternative", "self-hosted Riverside", "open-source podcast recorder".
5. **Ship weekly** + reply to issues within 24h for the first 3 months.
6. **Awesome lists:** awesome-selfhosted, awesome-podcasting, awesome-webrtc, OpenAlternative, AlternativeTo listing.
7. **Integrations as growth:** one-click deploy templates (Railway, Coolify, Dokploy, CapRover, Unraid, TrueNAS).

## Star targets

| Milestone | Stars | Signal |
|---|---|---|
| Launch week | 500–2,000 | Front page HN/r/selfhosted |
| Month 3 | 2–5k | Weekly releases, first contributors |
| Month 12 | 5–15k | Steady growth, cloud customers |

## Community → revenue
- Self-hosters report bugs and spread the word; businesses that find it via GitHub convert to cloud or license.
- Track "Powered by" link clicks on studio pages (optional, removable on paid plans).
