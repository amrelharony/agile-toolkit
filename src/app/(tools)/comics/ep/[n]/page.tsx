import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { CountDisclosure, VisitRecorder } from "@/components/visits/visit-recorder";
import { BOOK_EPISODES, bookEpisode, type BookEpisode } from "@/lib/comics/book-episodes";
import { BOOK_EPISODE_COUNT, comicHref, parseEp } from "@/lib/comics/entry";
import { panelImageUrl } from "@/lib/comics/images";
import { jsonLdScript, storyJsonLd } from "@/lib/comics/rights";
import {
  getReleasedStory,
  getStoryExtras,
  getStoryGuess,
  listReleasedEps,
  listReleasedWeekly,
} from "@/lib/comics/store";
import type { StoryExtras } from "@/lib/comics/extras";
import type { StoryGuessExtras } from "@/lib/comics/guess";
import type { Story, StorySummary } from "@/lib/comics/types";
import { NOT_FOUND_METADATA, comicMetadata } from "../../comic-metadata";
import { LatestComics } from "../../components/comic-card";
import { ComicPanels } from "../../components/comic-panels";
import { ComingSoon } from "../../components/coming-soon";
import { EpisodeNotes } from "../../components/episode-notes";
import { PosterIntro } from "../../components/intro/poster-intro";
import { ReplayIntro } from "../../components/intro/replay-intro";
import { PrintThemeChip } from "../../components/print-theme-chip";
import { ReadAheadLink } from "../../components/read-ahead-link";
import { RightsNotice } from "../../components/rights-notice";
import { SeenAtWork } from "../../components/seen-at-work";
import { StreakNote } from "../../components/reader-progress";
import { ReadTracker } from "../../components/story-actions";
import { StoryNav } from "../../components/story-nav";
import { StoryQuiz } from "../../components/story-quiz";
import { TakeItToYourTeam } from "../../components/take-it-to-your-team";

/**
 * An episode, behind /comics?ep=N (the middleware rewrites to here and sends
 * direct visits back). Static, so it reads no cookies and no query: a poster, a
 * kudos card and a shared link all open this same page.
 *
 * Episodes 1-26 are the printed book's. They're never put online, so their page
 * is what the poster and kudos card print, word for word from the campaign's
 * data file (lib/comics/book-episodes), and points to the book for the comic.
 * Episodes 27 on are the weekly stories, from the store, and say "coming soon"
 * until they're out.
 *
 * Every book episode is prerendered, so an outage can't break a printed link:
 * a read that throws keeps the copy from the build or the last good refresh.
 */
export const revalidate = 600;

/** The poster's QR leads here, so show what's new under it, as its page did. */
const LATEST_COUNT = 3;

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
  const canonical = comicHref(ep);
  const book = bookEpisode(ep);
  if (book) {
    // The book's episodes stay out of search, so the book keeps its value.
    return comicMetadata({
      title: `${book.title} — Agile at Work`,
      description: book.lesson,
      canonical,
      index: false,
    });
  }
  const story = await getReleasedStory(ep);
  if (story) {
    return comicMetadata({
      title: `${story.title} — Agile at Work`,
      description: story.lesson,
      canonical,
      index: true,
      image: story.sharePath ? panelImageUrl(story.sharePath) : null,
    });
  }
  // Says nothing about the story: this number may be next Sunday's.
  return comicMetadata({
    title: "Coming soon — Agile at Work",
    description: "This comic is coming soon.",
    index: false,
  });
}

/** What a book episode's poster and kudos card print, and where to read it. */
function BookEpisodePage({
  episode,
  latest,
}: {
  episode: BookEpisode;
  latest: readonly StorySummary[];
}) {
  const { ep, title } = episode;
  return (
    <>
      {/* Beside the wrapper, not in it: its entrance leaves a transform behind,
          and the intro's fixed overlay would cover the wrapper, not the screen. */}
      <PosterIntro ep={ep} title={title} panels={[]} />
      <ToolPageWrapper title={title} description={`Episode ${ep}, by Amr Elharony`}>
        <VisitRecorder path="/comics" />
        <div className="space-y-4">
          <p className="text-sm text-sub">
            <span className="sr-only">Habit: </span>
            <PrintThemeChip theme={episode.theme} />
          </p>
          <EpisodeNotes
            lesson={episode.lesson}
            question={episode.question}
            bookPage={episode.bookPage}
          />
          <TakeItToYourTeam ep={ep} question={episode.question} themes={[]} kudos />
          <LatestComics stories={latest} />
          <StoryNav
            ep={ep}
            title={title}
            prevEp={ep > 1 ? ep - 1 : null}
            nextEp={ep < BOOK_EPISODE_COUNT ? ep + 1 : null}
          />
          <RightsNotice />
          <ReadAheadLink />
          <div className="flex items-baseline gap-4">
            {/* As on the list: the note gives way, so Replay keeps its words on one line. */}
            <div className="min-w-0 flex-1">
              <CountDisclosure />
            </div>
            <ReplayIntro kind="poster" />
          </div>
        </div>
      </ToolPageWrapper>
    </>
  );
}

/** Weekly stories skip whatever isn't out yet. */
async function weeklyNeighbours(ep: number) {
  const released = await listReleasedEps("weekly");
  return {
    prevEp: released.filter((n) => n < ep).pop() ?? null,
    nextEp: released.find((n) => n > ep) ?? null,
  };
}

function WeeklyStoryPage({
  story,
  prevEp,
  nextEp,
  extras,
  guess,
}: {
  story: Story;
  prevEp: number | null;
  nextEp: number | null;
  extras: StoryExtras;
  guess: StoryGuessExtras;
}) {
  const { ep, title } = story;
  return (
    <ToolPageWrapper title={title} description={`Episode ${ep}, by Amr Elharony`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(storyJsonLd(story)) }}
      />
      <VisitRecorder path="/comics" />
      <div className="space-y-4">
        <ComicPanels panels={story.panels} title={title} ep={ep} guess={guess.guess} />
        <EpisodeNotes lesson={story.lesson} question={story.squadQuestion} />
        {story.panels.length > 0 ? <SeenAtWork ep={ep} /> : null}
        <TakeItToYourTeam
          ep={ep}
          question={story.squadQuestion}
          themes={story.themes}
          tryTool={extras.tryTool}
          tryAction={guess.tryAction}
        />
        {extras.quiz ? <StoryQuiz ep={ep} quiz={extras.quiz} /> : null}
        <StoryNav ep={ep} title={title} prevEp={prevEp} nextEp={nextEp} />
        {/* Only a story with its art can be read to the end. */}
        {story.panels.length > 0 ? <ReadTracker ep={ep} /> : null}
        {story.panels.length > 0 ? <StreakNote /> : null}
        <RightsNotice />
        <ReadAheadLink />
        <CountDisclosure />
      </div>
    </ToolPageWrapper>
  );
}

export default async function ComicStoryPage({ params }: StoryPageProps) {
  const ep = parseEp(params.n);
  if (ep === null) notFound();
  const book = bookEpisode(ep);
  if (book) {
    return <BookEpisodePage episode={book} latest={await listReleasedWeekly(LATEST_COUNT)} />;
  }
  const story = await getReleasedStory(ep);
  // Counted here too: a page with no recorder would leave the arrival to the
  // next page of the visit, which isn't one.
  if (!story)
    return (
      <>
        <VisitRecorder path="/comics" />
        <ComingSoon />
      </>
    );
  const [{ prevEp, nextEp }, extras, guess] = await Promise.all([
    weeklyNeighbours(ep),
    getStoryExtras(ep),
    getStoryGuess(ep),
  ]);
  return (
    <WeeklyStoryPage story={story} prevEp={prevEp} nextEp={nextEp} extras={extras} guess={guess} />
  );
}
