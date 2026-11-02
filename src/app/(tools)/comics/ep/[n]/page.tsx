import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { BOOK_EPISODES, bookEpisode } from "@/lib/comics/book-episodes";
import { BOOK_EPISODE_COUNT, comicHref, isBookEp, parseEp } from "@/lib/comics/entry";
import { panelImageUrl } from "@/lib/comics/images";
import { jsonLdScript, storyJsonLd } from "@/lib/comics/rights";
import { NO_EXTRAS } from "@/lib/comics/extras";
import { getReleasedStory, getStoryExtras, listReleasedEps } from "@/lib/comics/store";
import type { Story } from "@/lib/comics/types";
import { NOT_FOUND_METADATA, comicMetadata } from "../../comic-metadata";
import { ArtComingSoon } from "../../components/art-coming-soon";
import { ComicPanels } from "../../components/comic-panels";
import { ComingSoon } from "../../components/coming-soon";
import { EpisodeNotes } from "../../components/episode-notes";
import { ReadAheadLink } from "../../components/read-ahead-link";
import { RightsNotice } from "../../components/rights-notice";
import { ReadTracker } from "../../components/story-actions";
import { StoryNav } from "../../components/story-nav";
import { StoryQuiz } from "../../components/story-quiz";
import { TakeItToYourTeam } from "../../components/take-it-to-your-team";

/**
 * A story, behind /comics?ep=N (the middleware rewrites to here and sends direct
 * visits back). Static, so it reads no cookies and no query.
 *
 * All 26 book episodes are prerendered even if the store is empty, and that's
 * what keeps printed links working: during an outage the read throws, the ISR
 * refresh fails, and the copy from the build or the last good refresh stays up.
 */
export const revalidate = 600;

interface StoryPageProps {
  params: { n: string };
}

export async function generateStaticParams(): Promise<{ n: string }[]> {
  const book = BOOK_EPISODES.map((e) => e.ep);
  let weekly: number[] = [];
  try {
    weekly = await listReleasedEps("weekly");
  } catch {
    // The rest render on first visit.
  }
  return [...book, ...weekly].map((ep) => ({ n: String(ep) }));
}

export async function generateMetadata({ params }: StoryPageProps): Promise<Metadata> {
  const ep = parseEp(params.n);
  // A 404: no address of its own, never the internal one behind the rewrite.
  if (ep === null) return NOT_FOUND_METADATA;
  const story = await getReleasedStory(ep);
  const book = bookEpisode(ep);
  const canonical = comicHref(ep);
  if (story) {
    return comicMetadata({
      title: `${story.title} — Agile at Work`,
      description: story.lesson,
      canonical,
      index: story.collection === "weekly",
      image: story.sharePath ? panelImageUrl(story.sharePath) : null,
    });
  }
  if (book) {
    return comicMetadata({
      title: `${book.title} — Agile at Work`,
      description: book.lesson,
      canonical,
      index: false,
    });
  }
  // Says nothing about the story: this number may be next Monday's.
  return comicMetadata({
    title: "Coming soon — Agile at Work",
    description: "This comic is coming soon.",
    index: false,
  });
}

/** Book episodes run 1-26 as printed; weekly stories skip what isn't released. */
async function neighbours(story: Pick<Story, "ep" | "collection">) {
  if (story.collection === "book") {
    return {
      prevEp: story.ep > 1 ? story.ep - 1 : null,
      nextEp: story.ep < BOOK_EPISODE_COUNT ? story.ep + 1 : null,
    };
  }
  const released = await listReleasedEps("weekly");
  return {
    prevEp: released.filter((ep) => ep < story.ep).pop() ?? null,
    nextEp: released.find((ep) => ep > story.ep) ?? null,
  };
}

export default async function ComicStoryPage({ params }: StoryPageProps) {
  const ep = parseEp(params.n);
  if (ep === null) notFound();

  const story = await getReleasedStory(ep);
  const book = bookEpisode(ep);
  if (!story && !book) return <ComingSoon />;
  const extras = story ? await getStoryExtras(ep) : NO_EXTRAS;

  const title = story?.title ?? book!.title;
  const { prevEp, nextEp } = await neighbours({
    ep,
    collection: isBookEp(ep) ? "book" : "weekly",
  });

  return (
    <ToolPageWrapper title={title} description={`Episode ${ep}, by Amr Elharony`}>
      {story ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(storyJsonLd(story)) }}
        />
      ) : null}
      <div className="space-y-4">
        {story ? <ComicPanels panels={story.panels} title={title} /> : null}
        <EpisodeNotes
          lesson={story?.lesson ?? book!.lesson}
          question={story?.squadQuestion ?? book!.question}
          bookPage={story?.bookPage ?? book?.bookPage}
        />
        <TakeItToYourTeam
          ep={ep}
          question={story?.squadQuestion ?? book!.question}
          themes={story?.themes ?? []}
          tryTool={extras.tryTool}
        />
        {extras.quiz ? <StoryQuiz ep={ep} quiz={extras.quiz} /> : null}
        {story ? null : <ArtComingSoon />}
        <StoryNav ep={ep} title={title} prevEp={prevEp} nextEp={nextEp} />
        {/* Only a story with its art can be read to the end. */}
        {story && story.panels.length > 0 ? <ReadTracker ep={ep} /> : null}
        <RightsNotice />
        <ReadAheadLink />
      </div>
    </ToolPageWrapper>
  );
}
