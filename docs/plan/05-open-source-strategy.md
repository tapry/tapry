# 05 — Open-Source Strategy

## License
- **AGPL-3.0** core (like Cap, Cal.com, Plausible): anyone can self-host; companies offering a modified hosted version must open their changes → pushes them to a commercial licence.
- **`/ee`** (SSO, advanced roles, admin policies) under a commercial licence: free to read, paid in production.
- **`packages/recorder` under MIT** → adoption as a library, stars, contributors, future embeddable product.
- CLA or DCO so dual licensing stays possible.
- Check dependency licences (LiveKit Apache 2.0, ffmpeg build LGPL/GPL config, Whisper MIT, AI model licences).

## Repo setup (day 1)
- README: 20-second demo at top (throttled Wi-Fi → blurry call → crisp recording), one-command install, feature list, comparison table (Riverside / SquadCast / Zoom / VDO.Ninja), **published browser test matrix**, roadmap, cloud waitlist.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue templates (bug, feature, browser report), labels (`good first issue`, `browser:safari`, `privacy`).
- GitHub Discussions + Discord; public roadmap (GitHub Projects); weekly releases; images on GHCR.

## How to get stars

1. **Demo that shows the magic:** throttle Wi-Fi → live call blurry → final recording crisp; kill a guest's tab → rejoin → nothing lost.
2. **Launch week in 48 hours:** Show HN, r/selfhosted, r/opensource, r/podcasting, X thread, LinkedIn, Product Hunt.
3. **Deep technical posts:**
   - "How we record every guest locally in the browser and never lose a file" (OPFS, multipart, sync)
   - "Perfect speaker labels without diarization: one track per person"
   - "Private AI: transcripts and summaries that never leave your server"
4. **Comparison pages:** Riverside alternative, SquadCast alternative, self-hosted podcast recorder, GDPR interview recording.
5. Ship weekly; reply to issues within 24 h for the first 3 months.
6. **Lists:** awesome-selfhosted, awesome-podcasting, awesome-webrtc, OpenAlternative, AlternativeTo, selfh.st.
7. **Deploy templates:** Coolify, Dokploy, Railway, Unraid, TrueNAS, CapRover.
8. GitHub star count in the website header (Cap style).

## Star targets

| Milestone | Stars | Signal |
|---|---|---|
| Launch week | 500–2,000 | Front page HN / r/selfhosted |
| Month 3 | 2–5k | Weekly releases, first contributors |
| Month 12 | 5–15k | Steady growth, organisation customers |

## Community → revenue
- Self-hosters find bugs and spread the word; organisations discover via GitHub → cloud, licence or support.
- Opt-in anonymous install ping (version, count) to measure self-hosted installs.
- "Powered by Tapry" on free-cloud studio pages (removable on paid plans).
