import type { Metadata } from "next";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";
import { COMICS_ROUTE } from "@/lib/comics/entry";
import { posterCover } from "@/lib/comics/poster-panels";
import { pickFavourites } from "@/lib/comics/stats";
import { listReleasedWeekly, listStoryTotals } from "@/lib/comics/store";
import { CAST } from "@/lib/vip/cast.generated";
import { comicMetadata } from "./comic-metadata";
import { ComicsGallery } from "./components/comics-gallery";
import { BookIntro } from "./components/intro/book-intro";

/**
 * Static, refreshed once a day, and at once by the release-hour cron or an owner
 * save (lib/comics/revalidate). Every 10 minutes ran to ~680K ISR write units in
 * its first week and paused the site on Hobby (Nov 2026). A /comics address with
 * a valid number never gets
 * here: the middleware rewrites it to ep/[n]. Everything else, the book's and
 * open kudos cards' QR codes included, lands here.
 */
export const revalidate = 86400;

export const metadata: Metadata = comicMetadata({
  title: "Agile at Work — workplace comics",
  description:
    "Capable colleagues, familiar workplace habits, and small choices that make work better.",
  canonical: COMICS_ROUTE,
});

/**
 * The book's intro opens onto the story the gallery leads with. It sits beside
 * the gallery, not in it: ToolPageWrapper's entrance leaves a transform that
 * would trap a fixed overlay.
 */
/** Names only: the rest of each card is the bible's and stays on the VIP pages. */
const CAST_NAMES = CAST.map((c) => c.name);

export default async function ComicsPage() {
  const [stories, totals] = await Promise.all([listReleasedWeekly(), listStoryTotals()]);
  const [latest] = stories;
  // Worked out here, at each refresh: the gallery never fetches counts in bulk.
  const favourites = pickFavourites(
    stories,
    new Map(Array.from(totals, ([ep, t]) => [ep, t.loves] as const))
  );
  return (
    <>
      <BookIntro latest={latest ? { title: latest.title, cover: latest.cover } : null} />
      <ComicsGallery
        stories={stories}
        bookEpisodes={BOOK_EPISODES.map(({ ep, title, theme }) => ({
          ep,
          title,
          theme,
          cover: posterCover(ep),
        }))}
        cast={CAST_NAMES}
        favourites={favourites}
      />
    </>
  );
}
