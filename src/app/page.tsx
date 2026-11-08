import { ComicBanner } from "@/components/home/comic-banner";
import { HomePage } from "@/components/home/home-page";
import { listReleasedWeekly } from "@/lib/comics/store";
import type { StorySummary } from "@/lib/comics/types";

/**
 * Once a day, like /comics, and at once when a story comes out or is saved
 * (lib/comics/revalidate), so a Sunday's story reaches home too.
 */
export const revalidate = 86400;

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

export default async function Home() {
  return <HomePage comicBanner={<ComicBanner latest={await latestStory()} />} />;
}
