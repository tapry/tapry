# Tapry Cloud: plans and billing

What a server run as Tapry Cloud does that a self-hosted one doesn't, what is built, and what
still stands between here and the first payment. Prices and reasons: `docs/plan/06-monetization.md`.

A self-hosted server is unaffected by all of this: without `TAPRY_CLOUD=true` there are no plans,
no limits, no Plan tab, and the billing endpoints answer 404.

## Built

| Part | What it does |
|---|---|
| **Plans** (`PLANS` in `packages/shared`) | Free, Creator, Studio, Team, Business: recording hours a month, days the finished files and the originals are kept, the guest badge |
| **Hours** (`BillingService`, `src/server/billing.ts`) | Counted per recording (not per person), deleted recordings included, per billing month: the calendar month on Free, the subscription's day of the month otherwise |
| **The limit** | Record is refused (402 `hours_used_up`, shown in the room) once the month's hours are used. A recording that is running is never stopped, and uploads are never refused for it |
| **Retention** | When a recording's files are ready it gets `keep_until` (the plan's days) and its originals a `purge_raw` job (7 days). The job runner deletes recordings past `keep_until`, the way a host deletes one. A bigger plan extends what is already recorded; a smaller one never shortens it |
| **Badge** | Guests of a Free-plan host see the "Record your own, free" link (`GUEST_PROMO_URL`) on the end screen, the recap page and the recap email; paid plans don't |
| **Plan tab** (Settings) | Plan, hours used this month, what is kept how long, links to buy a bigger plan, the provider's portal. Recordings show "Kept until …" |
| **Plans by hand** | The admin sets an account's plan in the Plan tab (`PUT /api/admin/accounts/:id/plan`): founding members, organisations paying by invoice. Refused for an account with a subscription |
| **Confirming the address** | A new account gets a link by email and can't create or open a studio until it is opened (needs `SMTP_HOST`; the first account is exempt). A notice on every dashboard page offers to send it again |
| **Webhook** (`POST /api/billing/webhook`) | Paddle Billing and Lemon Squeezy: signature checked, each event applied once, older events never overwrite newer state. Follows new subscriptions, plan changes, failed payments, cancellations and the end |

## Setting it up

```
TAPRY_CLOUD=true
ALLOW_SIGNUP=true
BILLING_PROVIDER=paddle                 # or lemonsqueezy
BILLING_WEBHOOK_SECRET=…                # the webhook's signing secret
BILLING_PRICES=pri_abc=creator,pri_def=creator,pri_xyz=studio   # monthly and yearly price ids → plan
BILLING_CHECKOUT_URLS=creator=https://…{user_id}…{email},studio=https://…
BILLING_MANAGE_URL=https://…            # the provider's customer portal
SMTP_HOST=…  SMTP_FROM=…  APP_URL=…     # email: confirming addresses, new passwords, guests' recap
GUEST_PROMO_URL=https://tapry.app/      # the Free plan's badge
```

The checkout address must carry the account's id to the provider as custom data named `user_id`
(`{user_id}` is replaced with it), because the webhook finds the account by it. A plan without a
checkout address isn't offered. A separate worker reads `TAPRY_CLOUD` too: it does the retention.

## Not built yet

| Missing | Why it matters | Blocks |
|---|---|---|
| **A live test against the provider** | The webhook readers are written from the published formats and tested with payloads of that shape, never with a real account | The first sale |
| **Seats** (several people in one account) | Studio and Team list 3 and 5 seats; today an account is one person | Selling Studio and Team as described |
| **Own storage** (the customer's bucket) | The $12 plan and the founding offer | Selling those |
| **Extra hours and longer keeping** | The add-ons in the pricing | Nothing: later |
| **A warning before deletion** | Today the date is on the recording; an email a few days before would be kinder | Nothing, but do it before the first paying customers reach their date |
| **Sign-up limits** | Per-address limits on new accounts (confirming the address already stops unconfirmed ones from recording) | Opening sign-up |
| **Terms, privacy policy, data processing agreement** | The legal page is a draft | Taking money |
| **SSO, audit log** (`/ee`) | Business and the organisation licence | Selling those |

## Only the owner can do

- Open the merchant-of-record account and confirm payouts to Morocco (`docs/plan/09-risks-legal.md`). Paddle or Lemon Squeezy: the code takes either.
- Create the products and prices there, and give this server the price ids, checkout addresses and webhook secret.
- A domain, a server, storage and an email provider for the hosted version.
- Make the repository and images public.

## Payment providers for a seller in Morocco (checked 13 Nov 2026)

From the providers' own pages unless marked. Not legal or tax advice; re-check before applying.

| Provider | Sellers in Morocco | Payout | Fee |
|---|---|---|---|
| **Paddle Billing** | Yes: Morocco is not on its unsupported list; individuals skip business verification | Bank wire or Payoneer, monthly, minimum $100 | 5% + $0.50 |
| **Creem** | Listed, but its bank-payout cell for Morocco is blank: ask support in writing first | Bank (USD/EUR), minimum $50 | 3.9% + $0.40 |
| **Lemon Squeezy** | Yes, pays to Moroccan banks, but it is steering sellers to Stripe Managed Payments, which excludes Morocco | Bank, 1% per payout | 5% + $0.50, plus surcharges |
| Stripe, Stripe Managed Payments, Polar, Dodo Payments | No | | |
| FastSpring, 2Checkout, Gumroad, Wise Business | Not stated on their pages | | |
| PayPal, Payoneer | Receive only: not a merchant of record, no tax handling | | |

- **First choice: Paddle.** It also issues invoices payable by bank transfer, which suits yearly organisation contracts. It reviews the website before approving: live pricing, terms, privacy and refund pages must exist.
- **Moroccan rules to take to an accountant:** proceeds of exported services must be brought home within 90 days; the auto-entrepreneur ceiling for services (200,000 MAD a year, secondary source) is reached quickly at these prices; a US company formed by a Moroccan resident appears to need Office des Changes authorisation.
- The webhook reader for Paddle is built; Creem has none yet.
