import type { MetadataRoute } from "next";

/** Mirrors `metadataBase` in src/app/layout.tsx. */
const SITE_URL = "https://agile.amrelharony.com";

/**
 * /robots.txt — the tools are public and indexable. Everything else is
 * kept out: the owner-only API and settings pages, the auth flow, the
 * squad-guest tree (invite-code pages), the visitor live-room join links
 * (/join/<tool>/<code>), the private colour edition of the comic (its QR
 * link and reader) and the not-authorized page. These also carry
 * `noindex` metadata where they render HTML; robots.txt just saves
 * crawlers the requests.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/auth/",
        "/settings/",
        "/guest/",
        "/join/",
        "/agile-at-work/color",
        "/not-authorized",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
