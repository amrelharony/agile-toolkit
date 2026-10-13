import type { MetadataRoute } from "next";
import { tools } from "@/lib/constants/tools";
import { COMIC_ROUTE, comicAsset } from "@/lib/comic/agile-at-work";

/** Mirrors `metadataBase` in src/app/layout.tsx. */
const SITE_URL = "https://agile.amrelharony.com";

/**
 * /sitemap.xml — the landing page plus every public tool route, straight from
 * the tool registry so new tools are indexed without touching this file. The
 * comic reader is listed only once its PDF exists (decided at build time), so
 * search engines never index a "coming soon" page.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const showComic = comicAsset().available;
  const paths = new Set<string>(["/"]);
  for (const tool of tools) {
    if (tool.path === COMIC_ROUTE && !showComic) continue;
    paths.add(tool.path);
  }
  return Array.from(paths, (path) => ({ url: `${SITE_URL}${path}` }));
}
