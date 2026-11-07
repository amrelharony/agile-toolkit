import type { Metadata } from "next";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";
import { COMICS_ROUTE } from "@/lib/comics/entry";
import { listReleasedWeekly } from "@/lib/comics/store";
import { CAST } from "@/lib/vip/cast.generated";
import { comicMetadata } from "./comic-metadata";
import { ComicsGallery } from "./components/comics-gallery";
import { BookIntro } from "./components/intro/book-intro";

/**
 * Static, refreshed about every 10 minutes, which is also how a Sunday's story
 * goes live with no scheduler. A /comics address with a valid number never gets
 * here: the middleware rewrites it to ep/[n]. Everything else, the book's and
 * open kudos cards' QR codes included, lands here.
 */
export const revalidate = 600;

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
  const stories = await listReleasedWeekly();
  const [latest] = stories;
  return (
    <>
      <BookIntro latest={latest ? { title: latest.title, cover: latest.cover } : null} />
      <ComicsGallery
        stories={stories}
        bookEpisodes={BOOK_EPISODES.map(({ ep, title, theme }) => ({ ep, title, theme }))}
        cast={CAST_NAMES}
      />
    </>
  );
}
