# Tapry Cloud: legal drafts

Drafts of the three texts a payment provider's review asks for (Paddle checks for live pricing,
terms, privacy and refund pages) and customers will read: Terms, Refund policy, Privacy policy,
plus the list of sub-processors a data processing agreement needs.

**Not legal advice, and not published.** They describe what the software does today
(`docs/cloud-billing.md`); every `[…]` is a fact or a decision only the owner has. Have a lawyer
read them before they go on the website, then move them into `apps/site/src/app/legal/` and take
"Draft for review" off that page.

## To fill in first

| Blank | What it is |
|---|---|
| `[LEGAL NAME]` | The person or company that runs Tapry Cloud and signs these terms |
| `[ADDRESS]`, `[CONTACT EMAIL]` | A postal address and an address people can write to |
| `[COUNTRY OF LAW]`, `[COURTS]` | The law the terms are under and where disputes go |
| `[HOSTING PROVIDER, COUNTRY]` | Where the servers run |
| `[STORAGE PROVIDER, REGION]` | Where recordings are stored (the Team plan promises the EU) |
| `[EMAIL PROVIDER]` | Who sends the emails |
| `[PAYMENT PROVIDER]` | The merchant of record (Paddle is the candidate) |
| `[EU REPRESENTATIVE]` | Needed under GDPR Art. 27 for a seller outside the EU with EU customers, once revenue is meaningful (`docs/plan/09-risks-legal.md`) |
| Refund window | 14 days is proposed below; the owner's decision |

---

## Terms of Service (Tapry Cloud)

**1. Who we are.** Tapry Cloud is run by `[LEGAL NAME]`, `[ADDRESS]` ("we"). Write to us at `[CONTACT EMAIL]`. These terms cover the hosted service at `[DOMAIN]`. The self-hosted software is separate: it is licensed under AGPL-3.0 (the recorder core under MIT) and these terms don't apply to it.

**2. Your account.** You need an account to host recordings; your guests never do. Give a real email address and confirm it: we use it to sign you in, to send account emails and to warn you before a recording is deleted. Keep your password to yourself; you are responsible for what is done with your account.

**3. Plans.** A plan gives you a number of recording hours each billing month and a time your finished files are kept. Hours are counted per recording, not per person, and a deleted recording still counts. When a month's hours are used up you can't start a new recording until the next month or a bigger plan; a recording that is running is never cut off. The current plans and prices are on the pricing page. We may change prices for future billing periods and will tell you by email at least 30 days before a change affects you.

**4. Paying.** Paid plans are sold by `[PAYMENT PROVIDER]`, our reseller and merchant of record: they take the payment, handle taxes and send your invoice, under their own terms. Subscriptions renew each month or year until you cancel. You can cancel at any time from Settings; the plan then runs to the end of the period you paid for and the account moves to the Free plan. If a payment fails the plan stays on while the payment is retried, then ends.

**5. How long we keep recordings.** The original uploads are removed 7 days after a recording is processed. The finished files are kept for the number of days your plan says, counted from when they were first ready, and the recording is then deleted. Each recording shows its date, and we email you before it is reached. Moving to a bigger plan extends the time for recordings you already have; moving to a smaller one never shortens it. **Deleted recordings can't be recovered: download what you want to keep.**

**6. Your recordings.** You own what you record. You give us only the permission we need to store, process and deliver it to you and your guests. You are responsible for having each guest's agreement to be recorded and for anything you publish. Tapry shows guests your consent text and keeps a record of who agreed, when, and to which text; whether that text is enough where you and your guests are is for you to decide.

**7. Acceptable use.** Don't record people without their knowledge. Don't use the service to break the law, to store material you have no right to, or to harm or overload the service. We may suspend an account that does, and will tell you why unless the law forbids it.

**8. Availability.** We work to keep the service running and your recordings safe: each person is recorded on their own device and uploaded during the session, so a dropped connection doesn't lose the recording. We don't promise uninterrupted service. Plans with a support promise say so on the pricing page.

**9. Ending.** You can delete your recordings and stop using the service at any time; write to us to have the account itself removed. We may close an account that breaks these terms, or end the service with at least 60 days' notice by email, during which you can download everything.

**10. Liability.** To the extent the law allows, the service is provided as it is, and our total liability to you is limited to what you paid us in the 12 months before the claim. Nothing here limits liability that can't be limited by law, or your rights as a consumer.

**11. Changes.** We may change these terms; we'll email you at least 30 days before a change that matters takes effect. If you don't agree you can cancel before then.

**12. Law.** These terms are under the law of `[COUNTRY OF LAW]`, and disputes go to `[COURTS]`, unless consumer law where you live says otherwise.

---

## Refund policy

- **First payment:** if Tapry Cloud isn't for you, ask within **14 days** of your first payment for a plan and we refund it in full, whether you paid for a month or a year.
- **Renewals:** not refunded once the new period has started, except where the law gives you that right. Cancel before the renewal date to avoid it; the pricing page and your invoice show the date.
- **If we fail you:** if a fault on our side loses a recording or keeps you from recording, write to us and we refund the period it happened in.
- **How:** write to `[CONTACT EMAIL]` from your account's address. Refunds are made by `[PAYMENT PROVIDER]` to the payment method you used, usually within 10 days.
- **One-time offers** (the founding offer): refundable within 14 days of purchase.

---

## Privacy policy (Tapry Cloud)

**Who is responsible.** `[LEGAL NAME]`, `[ADDRESS]`, `[CONTACT EMAIL]`. For what hosts record, the host decides why and how it is recorded (the controller) and we store and process it for them (the processor). `[EU REPRESENTATIVE]`.

**What we hold, and why**

| What | Why | How long |
|---|---|---|
| Your account: name, email, a hash of your password | To sign you in and write to you | Until the account is deleted |
| Your plan and the payment provider's ids for your customer and subscription | To give you what you paid for. No card detail ever reaches us | While you have an account |
| Recordings: each person's sound and picture, the finished files, transcripts | The service itself | Originals 7 days after processing; finished files for your plan's days; then deleted |
| Guests: the name they type, the consent text they agreed to and when | So the host knows who was recorded and has a record of consent | With the recording, or until the studio is deleted |
| A guest's email, only if they ask for a link to their own recording | To send that one email | Until it is sent or given up on; removed if the recording is deleted first |
| Tech-check results a guest chooses to send: name, browser, check outcomes | So the host can help before the session | 30 days shown; deleted with the studio |
| Quality signals during a session: levels, upload progress, alerts | Live status for the host | In memory, during the session |
| Server logs: times, ids, errors | To run and fix the service | `[LOG RETENTION]` |

**What we don't do.** No analytics, advertising or tracking. One cookie, which keeps you signed in. Sound, picture, transcript text and email addresses are never written to logs. Transcripts are made on our own servers, not sent to an AI company. We don't sell or share data, and don't use recordings to train anything.

**Who else handles it (sub-processors)**

| Who | For what | Where |
|---|---|---|
| `[HOSTING PROVIDER]` | Servers | `[COUNTRY]` |
| `[STORAGE PROVIDER]` | Stored recordings | `[REGION]` |
| `[EMAIL PROVIDER]` | Sending account and recap emails | `[COUNTRY]` |
| `[PAYMENT PROVIDER]` | Payments, taxes, invoices, as merchant of record under its own privacy policy | `[COUNTRY]` |

**Where.** `[Recordings are stored in REGION.]` Where data leaves the EU, `[the safeguard: e.g. standard contractual clauses]`.

**Security.** Passwords are stored as scrypt hashes. Sign-in sessions, emailed links and guests' tokens are stored only as hashes. Uploads and downloads go over HTTPS, straight to storage, through links that expire. Deleting a recording removes its files from storage.

**Your rights.** You can see, correct, download and delete what we hold about you; write to `[CONTACT EMAIL]`. A guest who wants their part of a recording removed should ask the host who recorded them; we help the host do it. You can complain to your data protection authority.

**Changes.** We'll email account holders before a change that matters.

---

## Data processing agreement

Organisations (the Team plan promises one) will ask for a DPA under GDPR Art. 28. It needs: the
sub-processor table above, the security measures above, a commitment to notify of breaches
(`[72 hours]`), help with data-subject requests, deletion at the end (covered by the retention
rules), and standard contractual clauses for any transfer outside the EU. Start from a lawyer's
template; the facts to put in it are in this file.
