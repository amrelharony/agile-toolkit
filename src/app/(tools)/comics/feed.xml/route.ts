import { renderFeed, FEED_ITEM_LIMIT } from "@/lib/comics/feed";
import { listReleasedWeekly } from "@/lib/comics/store";

/** Static like the pages, and it keeps its last good copy the same way. */
export const revalidate = 600;

export async function GET() {
  const stories = await listReleasedWeekly(FEED_ITEM_LIMIT);
  return new Response(renderFeed(stories), {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}
