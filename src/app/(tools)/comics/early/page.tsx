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
import { getEarlyStory, listEarlyWeekly } from "@/lib/comics/store";
import type { Story } from "@/lib/comics/types";
import { hasVipAccess } from "@/lib/vip/access";
import { comicMetadata } from "../comic-metadata";
import { ComicCard } from "../components/comic-card";
import { ComicPanels } from "../components/comic-panels";
import { EpisodeNotes } from "../components/episode-notes";
import { RightsNotice } from "../components/rights-notice";
import { releaseDayLabel } from "./release-day";

/**
 * /comics/early?ep=NN: the next four weeks of weekly stories, for book readers.
 *
 * The one comics page that reads a cookie, which is why it's its own dynamic
 * route: released stories stay static and only link here. The middleware rewrites
 * exactly /comics, so nothing touches this address. It checks access before any
 * read, so a locked visitor costs no query and learns nothing, not even whether a
 * number exists. Stories here have no share image, structured data or share link.
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

function NothingHere() {
  return (
    <ToolPageWrapper title="Read ahead" description="For readers of the printed book.">
      <EmptyState icon={BookImage} padding="lg" action={<BackToEarly />}>
        <p className="font-semibold text-text">This comic isn&apos;t ready to read ahead</p>
      </EmptyState>
    </ToolPageWrapper>
  );
}

function EarlyStory({ story }: { story: Story }) {
  return (
    <ToolPageWrapper
      title={story.title}
      description={`Episode ${story.ep}, by Amr Elharony. ${releaseDayLabel(story.releaseAt)}`}
    >
      <div className="space-y-4">
        <ComicPanels panels={story.panels} title={story.title} />
        <EpisodeNotes lesson={story.lesson} question={story.squadQuestion} />
        <BackToEarly />
        <RightsNotice />
      </div>
    </ToolPageWrapper>
  );
}

export default async function EarlyComicsPage({ searchParams }: EarlyPageProps) {
  if (!(await hasVipAccess())) return <VipLockPanel />;

  const ep = parseEp(searchParams.ep);
  if (ep !== null) {
    const found = await getEarlyStory(ep);
    if (found.status === "released") redirect(comicHref(ep));
    return found.status === "early" ? <EarlyStory story={found.story} /> : <NothingHere />;
  }

  const stories = await listEarlyWeekly();
  return (
    <ToolPageWrapper
      title="Read ahead"
      description="The next four weeks of Agile at Work, before everyone else. Thanks for reading the book."
    >
      {stories.length === 0 ? (
        <EmptyState
          icon={BookImage}
          padding="lg"
          action={
            <Button asChild variant="toolkit">
              <Link href={COMICS_ROUTE} prefetch={false}>
                See all comics
              </Link>
            </Button>
          }
        >
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
