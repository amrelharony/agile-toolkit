import "server-only";
import { revalidatePath } from "next/cache";
import { FLASHCARDS_ROUTE } from "./entry";

/**
 * Every episode page, by its route. Next tags a page with its app path, route
 * group included (patch-fetch's getDerivedTags), so this is the form that
 * matches them all.
 */
export const EPISODE_PAGES = "/(tools)/comics/ep/[n]";

/**
 * Refresh what a save or a release changed. The pages only refresh on their own
 * once a day, so this is what makes a change show now.
 *
 * Every episode page goes, not just the saved ones: a new story adds a "next"
 * link to the one before it, and the book's pages list the latest stories. The
 * saved episodes are named too, by internal path (/comics?ep=NN is a rewrite to
 * them), in case the route-wide refresh misses. The home page carries the
 * latest story's card.
 */
export function revalidateComics(eps: readonly number[]): void {
  revalidatePath("/");
  revalidatePath("/comics");
  revalidatePath(FLASHCARDS_ROUTE);
  revalidatePath("/comics/feed.xml");
  revalidatePath("/comics/sitemap.xml");
  revalidatePath(EPISODE_PAGES, "page");
  for (const ep of eps) revalidatePath(`/comics/ep/${ep}`);
}
