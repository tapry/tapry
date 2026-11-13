// The three Tapry Cloud plans on the pricing page. Edit names, text and features here.
//
// priceId: the Paddle price ids (live account; public, the browser sends them anyway). They must
// match BILLING_PRICES on the app server, which maps the same ids to plans when Paddle's webhook
// reports a subscription. Plans and limits themselves: packages/shared PLANS.
//
// listed: what the page shows until Paddle's own localized price arrives (or if it can't be
// fetched, e.g. a blocker). Paddle's totals replace it as returned: no maths on these.
export interface Tier {
  name: "Creator" | "Studio" | "Team";
  /** The app's plan id: the checkout lives at <app>/checkout/<plan>. */
  plan: "creator" | "studio" | "team";
  description: string;
  features: string[];
  priceId: { month: string; year: string };
  listed: { month: string; year: string };
  highlight?: boolean;
}

export const TIERS: Tier[] = [
  {
    name: "Creator",
    plan: "creator",
    description: "The same software on a server you don’t have to run, for one host.",
    features: ["15 recording hours a month", "Finished files kept for 30 days", "Transcripts included", "Up to 8 people in a recording"],
    priceId: { month: "pri_01m79er3538jn4a8pfs74h959s", year: "pri_01m79ese1xv5g21e7nkf17qt1b" },
    listed: { month: "$19", year: "$190" },
    highlight: true,
  },
  {
    name: "Studio",
    plan: "studio",
    description: "For studios that record every week and share the work.",
    features: ["40 recording hours a month", "3 seats", "Finished files kept for 60 days", "Transcripts included"],
    priceId: { month: "pri_01m79f3sbb5r30bzh4xpt9v2qk", year: "pri_01m79f4dh1y8yjzapav2d0909t" },
    listed: { month: "$39", year: "$390" },
  },
  {
    name: "Team",
    plan: "team",
    description: "For newsrooms, research groups and media teams that must know where recordings are kept.",
    features: ["80 recording hours a month", "5 seats", "Finished files kept for 90 days", "Hosted in the EU", "Email support"],
    priceId: { month: "pri_01m79f59cpfws36hqe51wkhbjc", year: "pri_01m79f5y2hms6x7g71k57m0kgd" },
    listed: { month: "$149", year: "$1,490" },
  },
];

/**
 * Paddle's browser settings for the localized prices. The environment is required with the
 * token, and never guessed: a build with a token but no environment fails, so the site can't
 * quietly ask the wrong Paddle account.
 */
export const PADDLE_TOKEN = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN || null;
const ENV = process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT;
if (PADDLE_TOKEN && ENV !== "production" && ENV !== "sandbox") {
  throw new Error("NEXT_PUBLIC_PADDLE_ENVIRONMENT must be production or sandbox when NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is set");
}
if (PADDLE_TOKEN && (ENV === "production") !== PADDLE_TOKEN.startsWith("live_")) {
  throw new Error("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN doesn't match NEXT_PUBLIC_PADDLE_ENVIRONMENT (live_ tokens are for production, test_ for sandbox)");
}
export const PADDLE_ENVIRONMENT = (ENV ?? null) as "production" | "sandbox" | null;
