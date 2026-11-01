"use client";

import Link from "next/link";
import { ArrowLeft, BookImage } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BOOK_EPISODES, type BookEpisode } from "@/lib/comics/book-episodes";

/** Printed on the back cover; the wording belongs to the book. */
const BOOK_BLURB =
  "In a fictional Cairo workplace, competing priorities, circular approvals and busy colleagues make getting things done surprisingly complicated. Across 26 comic stories, Amr and a memorable cast turn everyday challenges into humour, reflection and practical conversations about working better together.";

function BackToTools() {
  return (
    <Button asChild variant="toolkit" className="min-h-11 md:h-11">
      <Link href="/">
        <ArrowLeft aria-hidden="true" />
        Back to tools
      </Link>
    </Button>
  );
}

function EpisodeNotes({ episode }: { episode: BookEpisode }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div>
          <h2 className="font-semibold text-text">The lesson</h2>
          <p className="mt-1 text-sub">{episode.lesson}</p>
        </div>
        <div>
          <h2 className="font-semibold text-text">Ask your team:</h2>
          <p className="mt-1 text-sub">{episode.question}</p>
        </div>
        <div>
          <h2 className="font-semibold text-text">Read the full story.</h2>
          <p className="mt-1 text-sub">Book page {episode.bookPage}</p>
          <p className="mt-1 text-sub">Borrow the book from your Scrum Master.</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * /comics until the art is uploaded: every printed link lands on a real page
 * with the words already on its poster. Text only, so it needs no database.
 */
export function ComicsView({ episode }: { episode: BookEpisode | null }) {
  return (
    <ToolPageWrapper
      title={episode ? episode.title : "Agile at Work"}
      description={
        episode
          ? `Episode ${episode.ep} of ${BOOK_EPISODES.length}, by Amr Elharony`
          : "Workplace comics by Amr Elharony"
      }
    >
      <div className="space-y-4">
        {episode ? <EpisodeNotes episode={episode} /> : null}
        <EmptyState icon={BookImage} padding="lg" action={<BackToTools />}>
          <p className="font-semibold text-text">
            {episode ? "The comic will appear here soon" : "The comics are coming soon"}
          </p>
          {episode ? null : <p className="mt-1">{BOOK_BLURB}</p>}
        </EmptyState>
        <p className="text-center text-xs text-sub">© Amr Elharony. All rights reserved.</p>
      </div>
    </ToolPageWrapper>
  );
}
