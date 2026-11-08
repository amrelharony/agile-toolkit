import type { MetadataRoute } from "next";
import { comicHref } from "@/lib/comics/entry";
import { SITE_URL } from "@/lib/comics/rights";
import { listReleasedWeekly } from "@/lib/comics/store";

/**
 * /comics/sitemap.xml: released weekly stories only. Book episodes stay out so
 * the book keeps its value, and this lives apart from the root sitemap so that
 * one stays sync and needs no database.
 */
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stories = await listReleasedWeekly();
  return stories.map((story) => ({
    url: `${SITE_URL}${comicHref(story.ep)}`,
    lastModified: story.updatedAt,
  }));
}
