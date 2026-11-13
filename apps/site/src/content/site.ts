// Addresses the whole site links to. With NEXT_PUBLIC_APP_URL (the hosted app, Tapry Cloud) the
// site offers log in, sign up and plan checkouts there. Without it there is no hosted app:
// "Get Started" leads to the choice between self-hosting and the planned Tapry Cloud (pricing).
import type { Metadata } from "next";

export const GITHUB = process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/tapry/tapry";
export const GITHUB_FILE = (path: string) => `${GITHUB}/blob/main/${path}`;
export const SETUP_GUIDE = GITHUB_FILE("docs/self-hosting.md");
export const BROWSERS_DOC = GITHUB_FILE("docs/browser-support.md");
export const CHANGELOG_URL = GITHUB_FILE("CHANGELOG.md");
export const CONTRIBUTING_URL = GITHUB_FILE("CONTRIBUTING.md");
export const SECURITY_URL = GITHUB_FILE("SECURITY.md");
export const RELEASES_URL = `${GITHUB}/releases`;
export const BUG_REPORT_URL = `${GITHUB}/issues/new?template=bug.yml`;
export const BROWSER_REPORT_URL = `${GITHUB}/issues/new?template=browser.yml`;
/** The website's docs are written in this file (condensed from docs/ in the repo). */
export const DOCS_EDIT_URL = GITHUB_FILE("apps/site/src/content/docs.ts");

/** Where the waitlist form posts (a form service that takes an `email` field). Unset: link to GitHub releases. */
export const WAITLIST_URL = process.env.NEXT_PUBLIC_WAITLIST_URL;
export const HAS_WAITLIST = !!WAITLIST_URL;
/** How to hear about Tapry Cloud, for sentences: only promise a waitlist when there is one. */
export const CLOUD_NEWS = HAS_WAITLIST ? "join the waitlist" : "watch the releases on GitHub";
/** The Tapry server whose public speed test the website uses. Unset: the speed test isn't linked. */
export const SPEED_TEST_URL = process.env.NEXT_PUBLIC_SPEED_TEST_URL;
export const HAS_SPEED_TEST = !!SPEED_TEST_URL;
/** The site's public address (e.g. https://tapry.app), for absolute canonical links and the sitemap. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");

/** The hosted app (https://studio.tapry.app). Unset: Tapry Cloud is described as planned. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
export const HAS_CLOUD = !!APP_URL;
export const LOGIN_URL = `${APP_URL}/login`;
export const SIGNUP_URL = `${APP_URL}/signup`;
/** A plan's checkout in the app: it signs the visitor up first, then opens the payment. */
export const checkoutUrl = (plan: "creator" | "studio" | "team" | "own_storage", yearly: boolean) => `${APP_URL}/checkout/${plan}${yearly ? "?yearly=1" : ""}`;
export const CONTACT_EMAIL = "hello@tapry.app";

export const GET_STARTED = HAS_CLOUD ? SIGNUP_URL : "/pricing/";

/** A page's metadata: title, description, canonical address (with its trailing slash) and the same for link previews. */
export function pageMeta({ title, description, path, index = true }: { title: string; description: string; path: string; index?: boolean }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "Tapry", title, description, url: path },
    twitter: { card: "summary", title, description },
    ...(index ? {} : { robots: { index: false } }),
  };
}
