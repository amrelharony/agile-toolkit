import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { BOOK_EPISODES, bookEpisode } from "@/lib/comics/book-episodes";
import { comicHref, parseEp } from "@/lib/comics/entry";
import { getReleasedStory, listReleasedWeekly } from "@/lib/comics/store";
import { comicMetadata } from "../../comic-metadata";
import { LatestComics } from "../../components/comic-card";
import { ArtComingSoon } from "../../components/art-coming-soon";
import { ComicPanels } from "../../components/comic-panels";
import { EpisodeNotes } from "../../components/episode-notes";
import { CountDisclosure, EntryBeacon } from "../../components/entry-beacon";
import { ReadAheadLink } from "../../components/read-ahead-link";
import { RightsNotice } from "../../components/rights-notice";

/**
 * What a poster's QR code opens, behind /comics?ep=NN&b=NN. People are standing
 * at a wall, so it leads with the episode. One static page per episode, however
 * many buildings: the beacon reads the building from the address in the browser.
 *
 * All 26 are prerendered, so an outage keeps the last good copy and every
 * printed link keeps working (see ep/[n]/page.tsx).
 */
export const revalidate = 600;
export const dynamicParams = false;

const LATEST_COUNT = 3;

interface PosterPageProps {
  params: { n: string };
}

export function generateStaticParams(): { n: string }[] {
  return BOOK_EPISODES.map((e) => ({ n: String(e.ep) }));
}

export async function generateMetadata({ params }: PosterPageProps): Promise<Metadata> {
  const ep = parseEp(params.n);
  const book = ep === null ? null : bookEpisode(ep);
  if (ep === null || !book) return {};
  const story = await getReleasedStory(ep);
  return comicMetadata({
    title: `${story?.title ?? book.title} — Agile at Work`,
    description: story?.lesson ?? book.lesson,
    canonical: comicHref(ep),
    index: false,
  });
}

export default async function ComicPosterPage({ params }: PosterPageProps) {
  const ep = parseEp(params.n);
  const book = ep === null ? null : bookEpisode(ep);
  if (ep === null || !book) notFound();

  const [story, latest] = await Promise.all([
    getReleasedStory(ep),
    listReleasedWeekly(LATEST_COUNT),
  ]);
  const title = story?.title ?? book.title;

  return (
    <ToolPageWrapper title={title} description={`Episode ${ep}, by Amr Elharony`}>
      <EntryBeacon entry="poster" ep={ep} />
      <div className="space-y-4">
        {story ? <ComicPanels panels={story.panels} title={title} /> : null}
        <EpisodeNotes
          lesson={story?.lesson ?? book.lesson}
          question={story?.squadQuestion ?? book.question}
          bookPage={story?.bookPage ?? book.bookPage}
        />
        {story ? null : <ArtComingSoon />}
        <LatestComics stories={latest} />
        <RightsNotice />
        <ReadAheadLink />
        <CountDisclosure />
      </div>
    </ToolPageWrapper>
  );
}
