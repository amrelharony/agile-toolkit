import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { BOOK_EPISODES, bookEpisode } from "@/lib/comics/book-episodes";
import { comicHref, parseEp } from "@/lib/comics/entry";
import { panelImageUrl } from "@/lib/comics/images";
import { jsonLdScript, storyJsonLd } from "@/lib/comics/rights";
import { getReleasedStory, getStoryExtras, listReleasedWeekly } from "@/lib/comics/store";
import { NOT_FOUND_METADATA, comicMetadata } from "../../comic-metadata";
import { LatestComics } from "../../components/comic-card";
import { ArtComingSoon } from "../../components/art-coming-soon";
import { ComicPanels } from "../../components/comic-panels";
import { EpisodeNotes } from "../../components/episode-notes";
import { CountDisclosure, EntryBeacon } from "../../components/entry-beacon";
import { PosterIntro } from "../../components/intro/poster-intro";
import { ReplayIntro } from "../../components/intro/replay-intro";
import { ReadAheadLink } from "../../components/read-ahead-link";
import { RightsNotice } from "../../components/rights-notice";
import { ReadTracker } from "../../components/story-actions";
import { StoryQuiz } from "../../components/story-quiz";
import { TakeItToYourTeam } from "../../components/take-it-to-your-team";

/**
 * What a poster's QR code opens, behind /comics?ep=NN&b=NN. People are standing
 * at a wall, so it leads with the episode, and the first visit opens with a
 * three-second intro of it (PosterIntro). One static page per episode, however
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
  // A 404: no address of its own, never the internal one behind the rewrite.
  if (ep === null || !book) return NOT_FOUND_METADATA;
  const story = await getReleasedStory(ep);
  return comicMetadata({
    title: `${story?.title ?? book.title} — Agile at Work`,
    description: story?.lesson ?? book.lesson,
    canonical: comicHref(ep),
    index: false,
    // A poster link shared from the wall previews with the story, like the story's own link.
    image: story?.sharePath ? panelImageUrl(story.sharePath) : null,
  });
}

export default async function ComicPosterPage({ params }: PosterPageProps) {
  const ep = parseEp(params.n);
  const book = ep === null ? null : bookEpisode(ep);
  if (ep === null || !book) notFound();

  // The extras read is "none" for an episode with no story yet, so it needn't wait for one.
  const [story, latest, extras] = await Promise.all([
    getReleasedStory(ep),
    listReleasedWeekly(LATEST_COUNT),
    getStoryExtras(ep),
  ]);
  const title = story?.title ?? book.title;

  return (
    <>
      {/* Beside the wrapper, not in it: its entrance leaves a transform behind,
          and the intro's fixed overlay would cover the wrapper, not the screen. */}
      <PosterIntro ep={ep} title={title} panels={story?.panels ?? []} />
      <ToolPageWrapper title={title} description={`Episode ${ep}, by Amr Elharony`}>
        {story ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: jsonLdScript(storyJsonLd(story)) }}
          />
        ) : null}
        <EntryBeacon entry="poster" ep={ep} />
        <div className="space-y-4">
          {story ? <ComicPanels panels={story.panels} title={title} /> : null}
          <EpisodeNotes
            lesson={story?.lesson ?? book.lesson}
            question={story?.squadQuestion ?? book.question}
            bookPage={story?.bookPage ?? book.bookPage}
          />
          <TakeItToYourTeam
            ep={ep}
            question={story?.squadQuestion ?? book.question}
            themes={story?.themes ?? []}
            tryTool={extras.tryTool}
          />
          {extras.quiz ? <StoryQuiz ep={ep} quiz={extras.quiz} /> : null}
          {story && story.panels.length > 0 ? <ReadTracker ep={ep} /> : null}
          {story ? null : <ArtComingSoon />}
          <LatestComics stories={latest} />
          <RightsNotice />
          <ReadAheadLink />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <CountDisclosure />
            <ReplayIntro kind="poster" />
          </div>
        </div>
      </ToolPageWrapper>
    </>
  );
}
