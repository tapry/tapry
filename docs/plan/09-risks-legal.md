# 09 — Risks & Legal

## Product & technical risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Lost recordings** | Fatal for trust | OPFS buffering, resumable multipart, crash recovery, test matrix, "zero loss" release rule |
| Safari / mobile quirks | Broken guests | Feature detection, Safari-specific path, desktop recommendation, clear warnings |
| Sync drift on long sessions | Unusable edits | Server clock offset + audio cross-correlation + CFR normalization |
| Self-host support burden | Time sink | Great docs, Discord, issue templates, paid support only for license holders |
| Storage/processing costs in cloud | Margin squeeze | Retention limits, R2, usage caps, GPU batching |
| Riverside/StreamYard cut prices | Weaker pitch | Compete on ownership/self-host/privacy, not only price |
| VDO.Ninja / Jitsi add similar features | Competition | Focus on simplicity + podcast workflow + transcripts/editing |
| Solo founder bandwidth | Slow progress | Narrow v1 (2–4 guests, multitrack, self-host); defer streaming/webinars |

## Legal

### Recording consent
- Studio page states that the session is recorded; guests click "I agree to be recorded" before joining.
- Host is responsible for obtaining consent; terms of service say so. Some jurisdictions require all-party consent.

### Privacy (GDPR — users in EU)
- Privacy policy, DPA for business customers, subprocessors list (hosting, storage, transcription, payments).
- EU region option for cloud; data deletion and export.
- No training on customer media; transcripts processed only for the customer.
- Since the company is outside the EU, consider an EU representative (Art. 27) once revenue is meaningful.

### Abuse
- Terms of use banning illegal content; report/takedown process; rate limits on free tier; no public hosting/sharing pages in v1 (reduces abuse surface).

### Licensing
- AGPL-3.0 core + commercial `/ee` + MIT recorder library; CLA/DCO for contributions.
- Check licenses of all dependencies (LiveKit Apache 2.0, ffmpeg builds LGPL/GPL configuration, Whisper MIT).

## Company, payments & tax (Morocco-based founder)
- Merchant of record (Paddle or Lemon Squeezy) to handle EU/US VAT/sales tax. **Confirm payouts to Morocco before building billing.**
- Moroccan status (auto-entrepreneur vs SARL) and foreign-currency income: book an accountant call early.
- Business licenses with EU companies may need invoices from a company entity — plan for it by month 6.
