# 09 — Risks & Legal

## Product & technical risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Lost recordings** | Fatal | OPFS buffering, resumable multipart, crash recovery, live upload status, test matrix, zero-loss release rule |
| Safari / mobile quirks | Broken guests | Feature detection, Safari path, alerts, desktop recommendation |
| Sync drift on long sessions | Unusable edits | Server clock offset + audio cross-correlation + CFR normalisation |
| Quality alerts too noisy | Annoyed hosts | Tune thresholds in alpha; per-alert mute |
| Self-host support burden | Time sink | Docs, health page, Discord; paid support only for licence holders |
| Cloud storage/processing costs | Margin squeeze | Retention limits, R2, BYO storage, GPU batching |
| Private AI quality/cost | Weak summaries, GPU cost | Keep AI optional; transcripts first; small models; external API only if allowed |
| Competitors cut prices or add self-host | Weaker pitch | Compete on reliability + privacy + openness, not price |
| Ennuicastr / VDO.Ninja add missing pieces | Competition | Ship fast; focus on simplicity, interview workflow, organisation features |
| Organisations slow to buy | Revenue delay | Card-payable Research team plan; pilots; freelance income covers the gap |
| Solo founder bandwidth | Slow progress | Narrow v1 (2–4 guests, reliability, self-host); defer streaming/webinars/editing |

## Legal

### Recording consent
- Consent checkbox per guest with the studio's consent text; stored with timestamp and text hash.
- Host is responsible for lawful consent; terms say so. Some jurisdictions require all-party consent.

### Privacy (GDPR and others)
- Privacy policy, DPA template, subprocessors list (hosting, storage, payments; AI only if external enabled).
- EU region; data export and deletion; retention policies; audit log.
- **No training on customer media or transcripts.** No media/transcript text in logs.
- Special-category data (health, religion, ethnicity, etc.) is common in research interviews → recommend self-host or EU region + local AI; document data flows for ethics applications.
- Company outside the EU → consider an EU representative (Art. 27) once revenue is meaningful.
- Sector rules (HIPAA, FERPA) apply to some US customers: don't claim compliance until reviewed; self-host shifts responsibility to the customer.

### Research ethics
- Provide a **data-flow diagram + security description** researchers can paste into ethics applications.
- Never claim "ethics-board approved" in general; say "designed for ethics-board requirements" and list features.

### Abuse
- Terms banning illegal content; report/takedown process; rate limits on free cloud; no public hosting pages in v1.

### Licensing
- AGPL-3.0 core + commercial `/ee` + MIT recorder; CLA/DCO.
- Check licences: LiveKit (Apache 2.0), ffmpeg build (LGPL/GPL config), Whisper (MIT), AI model licences (some open-weight models restrict commercial use).

## Company, payments & tax (Morocco-based founder)
- Merchant of record (Paddle or Lemon Squeezy) for EU/US VAT/sales tax. **Confirm payouts to Morocco before building billing.**
- Moroccan status (auto-entrepreneur vs SARL) and foreign-currency income: accountant call early.
- Organisation licences and university purchases often require invoices from a company entity and supplier registration → plan a company by ~month 6 (Apr–May 2027), before Gate D pilots convert.
