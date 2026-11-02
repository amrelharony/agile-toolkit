import "server-only";
import { revalidatePath } from "next/cache";
import { FLASHCARDS_ROUTE, isBookEp } from "./entry";

/**
 * Refresh what a save changed, by concrete path: pages also refresh on their own
 * about every 10 minutes, and this is why the owner doesn't have to wait for it.
 * Internal paths, since /comics?ep=NN is a rewrite to them.
 */
export function revalidateComics(eps: readonly number[]): void {
  revalidatePath("/comics");
  revalidatePath(FLASHCARDS_ROUTE);
  revalidatePath("/comics/feed.xml");
  revalidatePath("/comics/sitemap.xml");
  for (const ep of eps) {
    revalidatePath(`/comics/ep/${ep}`);
    if (isBookEp(ep)) revalidatePath(`/comics/poster/${ep}`);
  }
}
