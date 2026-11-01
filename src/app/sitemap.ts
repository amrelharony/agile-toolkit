import type { MetadataRoute } from "next";
import { tools } from "@/lib/constants/tools";

/** Mirrors `metadataBase` in src/app/layout.tsx. */
const SITE_URL = "https://agile.amrelharony.com";

/**
 * /sitemap.xml — the landing page plus every public tool route, straight from
 * the tool registry so new tools are indexed without touching this file. The
 * stories have their own /comics/sitemap.xml, so this one stays sync.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = new Set<string>(["/"]);
  for (const tool of tools) paths.add(tool.path);
  return Array.from(paths, (path) => ({ url: `${SITE_URL}${path}` }));
}
