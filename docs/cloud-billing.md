# Tapry Cloud: plans and billing

What a server run as Tapry Cloud does that a self-hosted one doesn't, what is built, and what
still stands between here and the first payment. Prices and reasons: `docs/plan/06-monetization.md`.

A self-hosted server is unaffected by all of this: without `TAPRY_CLOUD=true` there are no plans,
no limits, no Plan tab, and the billing endpoints answer 404.

## Built

| Part | What it does |
|---|---|
| **Plans** (`PLANS` in `packages/shared`) | Free, Own storage, Creator, Studio, Team, Business: recording hours a month, days the finished files and the originals are kept, the guest badge |
| **Hours** (`BillingService`, `src/server/billing.ts`) | Counted per recording (not per person), deleted recordings included, per billing month: the calendar month on Free, the subscription's day of the month otherwise |
| **The limit** | Record is refused (402 `hours_used_up`, shown in the room) once the month's hours are used. A recording that is running is never stopped, and uploads are never refused for it |
| **Retention** | When a recording's files are ready it gets `keep_until` (the plan's days) and its originals a `purge_raw` job (7 days). The job runner deletes recordings past `keep_until`, the way a host deletes one. A bigger plan extends what is already recorded; a smaller one never shortens it |
| **Badge** | Guests of a Free-plan host see the "Record your own, free" link (`GUEST_PROMO_URL`) on the end screen, the recap page and the recap email; paid plans don't |
| **Plan tab** (Settings) | Plan, hours used this month, what is kept how long, links to buy a bigger plan, the provider's portal. Recordings show "Kept until …" |
| **Plans by hand** | The admin sets an account's plan in the Plan tab (`PUT /api/admin/accounts/:id/plan`): founding members, organisations paying by invoice. Refused for an account with a subscription |
| **Confirming the address** | A new account gets a link by email and can't create or open a studio until it is opened (needs `SMTP_HOST`; the first account is exempt). A notice on every dashboard page offers to send it again |
| **A warning before deletion** | Where the server sends email, each host gets one email listing the recordings within three days of their date, and a recording is deleted only a day or more after its warning went. A mail problem delays deleting; it never skips the warning |
| **Sign-up limit** | Five new accounts an hour from one address (attempts count), on any server with open sign-up |
| **Seats** | An account's owner invites people by link (Settings, Members); members see the account's studios and recordings and can host. The plan sets the seats (Studio 3, Team 5), counting open invitations; a smaller plan removes nobody. The plan, the bucket and the member list stay with the owner |
| **Own storage** | An account connects its own S3-compatible bucket on the Storage page (needs `STORAGE_SECRET_KEY`); its sessions then record there. The Own storage plan has no other storage, no hour limit and no deletion by us; Business may use it; other plans can't |
| **Checkout** (`/checkout/<plan>`) | With Paddle's client token set, each plan that has a price is bought on this page: it loads Paddle's script (only here) and opens the checkout with the account's id attached, by the month or the year. The owner's only |
| **Webhook** (`POST /api/billing/webhook`) | Paddle Billing and Lemon Squeezy: signature checked, each event applied once, older events never overwrite newer state. Follows new subscriptions, plan changes, failed payments, cancellations and the end |

## Setting it up

```
TAPRY_CLOUD=true
ALLOW_SIGNUP=true
BILLING_PROVIDER=paddle                 # or lemonsqueezy
BILLING_WEBHOOK_SECRET=…                # the webhook's signing secret
BILLING_PRICES=pri_abc=creator,pri_def=creator:yearly,pri_xyz=studio   # price ids → plan; ":yearly" marks the yearly price
BILLING_PADDLE_CLIENT_TOKEN=…            # Paddle: Developer tools → Authentication → client-side token
BILLING_PADDLE_SANDBOX=true             # while testing with sandbox-vendors.paddle.com; remove for live
BILLING_MANAGE_URL=https://…            # the provider's customer portal
SMTP_HOST=…  SMTP_FROM=…  APP_URL=…     # email: confirming addresses, new passwords, guests' recap
STORAGE_SECRET_KEY=…                    # own storage: encrypts customers' bucket keys. Never change it
GUEST_PROMO_URL=https://tapry.app/      # the Free plan's badge
```

A plan without a price isn't offered. A separate worker reads `TAPRY_CLOUD` too: it does the
retention. With another provider (Lemon Squeezy), set `BILLING_CHECKOUT_URLS=creator=https://…{user_id}…`
instead of the Paddle token: the address must carry the account's id as custom data named `user_id`.

### In Paddle

1. Test first in the sandbox (a separate account at sandbox-vendors.paddle.com).
2. **Catalog → Products:** one product per plan (Own storage, Creator, Studio, Team), each with a monthly and a yearly recurring price in USD: 12/120, 19/190, 39/390, 149/1,490. Copy each price id (`pri_…`) into `BILLING_PRICES`.
3. **Developer tools → Authentication:** create a client-side token → `BILLING_PADDLE_CLIENT_TOKEN`.
4. **Developer tools → Notifications:** a webhook destination at `https://<the app's address>/api/billing/webhook`, with the `subscription.*` events. Copy its secret key → `BILLING_WEBHOOK_SECRET`.
5. **Checkout → Checkout settings:** set the default payment link to the app's address, and add the app's domain to the approved domains (Paddle only opens its checkout on approved domains).
6. The customer portal's address (Paddle gives one per seller) → `BILLING_MANAGE_URL`.
7. Buy a plan with Paddle's test card, and check the Plan tab changes within a minute.

The founding offer is a one-time price, which the webhook doesn't read (it follows subscriptions):
sell it with a Paddle payment link and set the buyer's plan by hand in the Plan tab.

## Not built yet

| Missing | Why it matters | Blocks |
|---|---|---|
| **A live test against the provider** | The webhook readers are written from the published formats and tested with payloads of that shape, never with a real account | The first sale |
| **Extra hours and longer keeping** | The add-ons in the pricing | Nothing: later |
| **Terms, refund and privacy pages, data processing agreement** | Drafted in `docs/legal-drafts.md` from what the software does, with the owner's facts left blank; not on the website | The provider's review, and taking money |
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
