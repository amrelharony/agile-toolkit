import type { MetadataRoute } from "next";

/** Mirrors `metadataBase` in src/app/layout.tsx. */
const SITE_URL = "https://agile.amrelharony.com";

/**
 * /robots.txt — the tools are public and indexable. Everything else is
 * kept out: the owner-only API and settings pages, the auth flow, the
 * squad-guest tree (invite-code pages), the visitor live-room join links
 * (/join/<tool>/<code>), the book readers' VIP link and page (/vip) and
 * the not-authorized page, and the early comics every story links to
 * (/comics/early). These also carry `noindex` metadata where they render HTML;
 * robots.txt just saves crawlers the requests.
 *
 * Known AI crawlers are also told to stay out of the comics, the book's page
 * and /media, where its cover is. A crawler obeys only the group that names it,
 * so their group repeats the private paths too. Only crawlers that follow the
 * rules will take any notice.
 */
const PRIVATE_PATHS = [
  "/api/",
  "/auth/",
  "/settings/",
  "/guest/",
  "/join/",
  "/vip",
  "/comics/early",
  "/not-authorized",
];

/** The comic's art and the book's cover. */
const ART_PATHS = ["/comics", "/book", "/media/"];

const AI_CRAWLERS = [
  "GPTBot",
  "CCBot",
  "Google-Extended",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Bytespider",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: AI_CRAWLERS, allow: "/", disallow: [...PRIVATE_PATHS, ...ART_PATHS] },
    ],
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/comics/sitemap.xml`],
  };
}
