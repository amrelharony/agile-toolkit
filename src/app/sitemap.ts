import type { MetadataRoute } from "next";
import { tools } from "@/lib/constants/tools";
import { PRIVACY_PATH } from "@/lib/site/owner";

/** Mirrors `metadataBase` in src/app/layout.tsx. */
const SITE_URL = "https://agile.amrelharony.com";

/**
 * The public pages that are not tools, so the registry doesn't name them: the
 * team's roster and agreements, the shelf that links every tool kept off the
 * home page and the sidebar, and the page on what leaves a visitor's browser
 * and who runs the site. Pages about one browser's own activity (/history,
 * /insights) and the owner's settings stay out.
 */
const SITE_PAGES = ["/team", "/more-tools", PRIVACY_PATH];

/**
 * /sitemap.xml — the landing page, the pages in SITE_PAGES and every public
 * tool route, straight from the tool registry so new tools are indexed without
 * touching this file. The stories have their own /comics/sitemap.xml, so this
 * one stays sync. VIP tools are left out: their pages say noindex and show a
 * lock to a crawler anyway.
 *
 * URLs only, no lastModified: the registry holds no date for a tool, and a
 * made-up date is worse for a crawler than none.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = new Set<string>(["/", ...SITE_PAGES]);
  for (const tool of tools) {
    if (tool.access !== "vip") paths.add(tool.path);
  }
  return Array.from(paths, (path) => ({ url: `${SITE_URL}${path}` }));
}
