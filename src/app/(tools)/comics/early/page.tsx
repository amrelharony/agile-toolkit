import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BookImage } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { VipLockPanel } from "@/components/vip/vip-lock-panel";
import {
  COMICS_ROUTE,
  EARLY_COMICS_ROUTE,
  comicHref,
  earlyComicHref,
  parseEp,
} from "@/lib/comics/entry";
import { NO_GUESS, type StoryGuessExtras } from "@/lib/comics/guess";
import { getEarlyStory, getStoryGuess, getStoryTotals, listEarlyWeekly } from "@/lib/comics/store";
import type { StoryTotals } from "@/lib/comics/stats";
import type { Story } from "@/lib/comics/types";
import { hasVipAccess } from "@/lib/vip/access";
import { comicMetadata } from "../comic-metadata";
import { ComicCard } from "../components/comic-card";
import { ComicPanels } from "../components/comic-panels";
import { EpisodeNotes } from "../components/episode-notes";
import { LoveButton } from "../components/love-button";
import { RightsNotice } from "../components/rights-notice";
import { SeenAtWork } from "../components/seen-at-work";
import { StoryStats } from "../components/story-stats";
import { releaseDayLabel } from "./release-day";

/**
 * /comics/early?ep=NN: the next four weeks of weekly stories, for book readers.
 *
 * The one comics page that reads a cookie, which is why it's its own dynamic
 * route: released stories stay static and only link here. The middleware rewrites
 * exactly /comics, so nothing touches this address. It checks access before any
 * read, so a locked visitor costs no query and learns nothing, not even whether a
 * number exists. Stories here have no share image, structured data or share link.
 *
 * A story stays readable here for a short while after it comes out, because the
 * public page can still be the cached "coming soon": see EARLY_RELEASE_GRACE_SECONDS.
 *
 * Read on every request, it has no last good copy to fall back on the way the
 * public pages do, so a failed read says so here rather than throwing to the
 * error page, as the /vip hub does.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...comicMetadata({
    title: "Read ahead — Agile at Work",
    description: "For readers of the printed book.",
    index: false,
  }),
  robots: { index: false, follow: false },
};

interface EarlyPageProps {
  searchParams: { ep?: string | string[] };
}

function BackToEarly() {
  return (
    <Button asChild variant="outline">
      <Link href={EARLY_COMICS_ROUTE} prefetch={false}>
        <ArrowLeft aria-hidden="true" />
        All early comics
      </Link>
    </Button>
  );
}

function SeeAllComics() {
  return (
    <Button asChild variant="toolkit">
      <Link href={COMICS_ROUTE} prefetch={false}>
        See all comics
      </Link>
    </Button>
  );
}

/** The read's outcome, or null when it failed: never throw, see above. */
async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    console.warn("[comics/early] couldn't read the early comics:", err);
    return null;
  }
}

function CantLoad() {
  return (
    <ToolPageWrapper title="Read ahead" description="For readers of the printed book.">
      <EmptyState icon={BookImage} padding="lg" action={<SeeAllComics />}>
        <p className="font-semibold text-text">The early comics can&apos;t load just now</p>
        <p className="mt-1">Please try again in a few minutes.</p>
      </EmptyState>
    </ToolPageWrapper>
  );
}

function NothingHere() {
  return (
    <ToolPageWrapper title="Read ahead" description="For readers of the printed book.">
      <EmptyState icon={BookImage} padding="lg" action={<BackToEarly />}>
        <p className="font-semibold text-text">This comic isn&apos;t ready to read ahead</p>
      </EmptyState>
    </ToolPageWrapper>
  );
}

function EarlyStory({
  story,
  guess,
  totals,
}: {
  story: Story;
  guess: StoryGuessExtras;
  totals: StoryTotals;
}) {
  const readable = story.panels.length > 0;
  return (
    <ToolPageWrapper
      title={story.title}
      description={`Episode ${story.ep}, by Amr Elharony. ${releaseDayLabel(story.releaseAt)}`}
    >
      <div className="space-y-4">
        <ComicPanels panels={story.panels} title={story.title} ep={story.ep} guess={guess.guess} />
        {readable ? (
          <LoveButton ep={story.ep} initialLoves={totals.loves} initialReaders={totals.readers} />
        ) : null}
        <EpisodeNotes lesson={story.lesson} question={story.squadQuestion} />
        {readable ? <SeenAtWork ep={story.ep} /> : null}
        {guess.tryAction ? (
          <section aria-labelledby="try-heading" className="space-y-1">
            <h2 id="try-heading" className="font-display font-semibold text-text">
              Try it this week
            </h2>
            <p className="text-sub">{guess.tryAction}</p>
          </section>
        ) : null}
        <BackToEarly />
        <RightsNotice />
        {readable ? <StoryStats ep={story.ep} /> : null}
      </div>
    </ToolPageWrapper>
  );
}

export default async function EarlyComicsPage({ searchParams }: EarlyPageProps) {
  if (!(await hasVipAccess())) return <VipLockPanel />;

  const ep = parseEp(searchParams.ep);
  if (ep !== null) {
    const found = await attempt(() => getEarlyStory(ep));
    if (!found) return <CantLoad />;
    // Outside the attempt: redirect() works by throwing.
    if (found.status === "released") redirect(comicHref(ep));
    if (found.status !== "early") return <NothingHere />;
    // Soft like the public page's: a story still reads without its guess.
    const [guess, totals] = await Promise.all([
      getStoryGuess(ep, { early: true }).catch(() => NO_GUESS),
      getStoryTotals(ep),
    ]);
    return <EarlyStory story={found.story} guess={guess} totals={totals} />;
  }

  const stories = await attempt(listEarlyWeekly);
  if (!stories) return <CantLoad />;
  return (
    <ToolPageWrapper
      title="Read ahead"
      description="The next four weeks of Agile at Work, before everyone else. Thanks for reading the book."
    >
      {stories.length === 0 ? (
        <EmptyState icon={BookImage} padding="lg" action={<SeeAllComics />}>
          <p className="font-semibold text-text">Nothing to read ahead just now</p>
          <p className="mt-1">The next stories will appear here before they come out.</p>
        </EmptyState>
      ) : (
        <ul className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stories.map((story) => (
            <ComicCard
              key={story.ep}
              story={story}
              href={earlyComicHref(story.ep)}
              note={releaseDayLabel(story.releaseAt)}
            />
          ))}
        </ul>
      )}
    </ToolPageWrapper>
  );
}
