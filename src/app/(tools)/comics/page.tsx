import type { Metadata } from "next";
import { COMICS_ROUTE } from "@/lib/comics/entry";
import { listReleasedWeekly } from "@/lib/comics/store";
import { comicMetadata } from "./comic-metadata";
import { ComicsGallery } from "./components/comics-gallery";
import { BookIntro } from "./components/intro/book-intro";

/**
 * Static, refreshed about every 10 minutes, which is also how a Monday's story
 * goes live with no scheduler. A /comics address with a valid number never gets
 * here: the middleware rewrites it to ep/[n] or poster/[n].
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
export default async function ComicsPage() {
  const stories = await listReleasedWeekly();
  const [latest] = stories;
  return (
    <>
      <BookIntro latest={latest ? { title: latest.title, cover: latest.cover } : null} />
      <ComicsGallery stories={stories} />
    </>
  );
}
