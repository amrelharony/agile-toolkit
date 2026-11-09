import { ComicBanner } from "@/components/home/comic-banner";
import { HomePage } from "@/components/home/home-page";
import { listReleasedWeekly } from "@/lib/comics/store";
import { SECTION_ART } from "@/lib/ink/drawings/sections";
import type { StorySummary } from "@/lib/comics/types";

/** About every 10 minutes, like /comics, so a Sunday's story reaches home too. */
export const revalidate = 600;

/**
 * The home page never fails for the comic's sake: if the stories can't be read
 * it shows the book, where a comics page would keep its last good copy instead.
 */
async function latestStory(): Promise<StorySummary | null> {
  try {
    const [latest] = await listReleasedWeekly(1);
    return latest ?? null;
  } catch {
    return null;
  }
}

/**
 * The section drawings go down as props, so they reach the browser in the page's
 * data and its HTML rather than in home's JavaScript.
 */
export default async function Home() {
  return (
    <HomePage comicBanner={<ComicBanner latest={await latestStory()} />} sectionArt={SECTION_ART} />
  );
}
