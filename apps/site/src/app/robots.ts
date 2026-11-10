import type { MetadataRoute } from "next";
import { SITE_URL } from "@/content/site";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  // The sitemap needs absolute addresses, so it is only announced when the site's address is set.
  return { rules: { userAgent: "*", allow: "/" }, ...(SITE_URL ? { sitemap: `${SITE_URL}/sitemap.xml` } : {}) };
}
