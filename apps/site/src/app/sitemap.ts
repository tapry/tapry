import type { MetadataRoute } from "next";
import { postHref, posts } from "@/content/blog";
import { customers } from "@/content/customers";
import { DOCS, docHref } from "@/content/docs";
import { HAS_SPEED_TEST, LEGAL, SITE_URL } from "@/content/site";

export const dynamic = "force-static";

// Only pages that exist and are meant to be found: no customers while there are no stories, no
// blog while there are no posts, no speed test while it isn't connected, no draft legal page.
export default function sitemap(): MetadataRoute.Sitemap {
  if (!SITE_URL) return [];
  const paths = [
    "/",
    "/use-cases/",
    "/compare/",
    "/self-hosting/",
    "/pricing/",
    ...DOCS.map(docHref),
    "/resources/",
    "/about/",
    "/education/",
    "/tools/",
    "/mic-test/",
    "/recorder/",
    "/consent-form/",
    "/data-map/",
    ...(HAS_SPEED_TEST ? ["/upload-speed-test/"] : []),
    ...(LEGAL.published ? ["/legal/"] : []),
    ...(posts.length ? ["/blog/", ...posts.map(postHref)] : []),
    ...(customers.length ? ["/customers/", ...customers.map((c) => `/customers/${c.slug}/`)] : []),
  ];
  return paths.map((p) => ({ url: `${SITE_URL}${p}` }));
}
