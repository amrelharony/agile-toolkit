import Link from "@/components/motion/transition-link";
import { ArrowRight } from "lucide-react";
import { ComicCover } from "@/app/(tools)/comics/components/comic-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { COVER_SMALL_SIZE, COVER_SMALL_URL } from "@/lib/book/art";
import { BOOK, BOOK_PATH } from "@/lib/book/book";
import { COMICS_ROUTE, comicHref } from "@/lib/comics/entry";
import type { StorySummary } from "@/lib/comics/types";

/**
 * The comic on the home page, below the work tools: this week's story once one
 * is out, the book before that. Not a client component: the server page reads
 * the story and passes this in, already rendered.
 */
export function ComicBanner({ latest }: { latest: StorySummary | null }) {
  return (
    <section aria-labelledby="comic-banner-heading">
      {latest ? <ThisWeeksStory story={latest} /> : <TheBook />}
    </section>
  );
}

function ThisWeeksStory({ story }: { story: StorySummary }) {
  return (
    <Card
      className={
        story.cover ? "grid overflow-hidden sm:grid-cols-[minmax(0,18rem)_1fr]" : "overflow-hidden"
      }
    >
      {story.cover ? <ComicCover cover={story.cover} /> : null}
      <div className="space-y-2 p-4 sm:p-6">
        <Eyebrow>Agile at Work, this week&apos;s story</Eyebrow>
        <h2 id="comic-banner-heading" className="font-display text-lg font-semibold text-text">
          {story.title}
        </h2>
        <p className="text-sub">{story.lesson}</p>
        <Actions
          primary={{ href: comicHref(story.ep), label: "Read the story" }}
          secondary={{ href: BOOK_PATH, label: "About the book" }}
        />
      </div>
    </Card>
  );
}

function TheBook() {
  return (
    <Card className="flex gap-4 p-4 sm:gap-6 sm:p-6">
      {/* The heading names the card, so the cover needs no words of its own. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={COVER_SMALL_URL}
        width={COVER_SMALL_SIZE}
        height={COVER_SMALL_SIZE}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-24 w-24 shrink-0 rounded-md border border-border bg-surface sm:h-36 sm:w-36"
      />
      <div className="min-w-0 space-y-2">
        <Eyebrow>Workplace comics by {BOOK.author}</Eyebrow>
        <h2 id="comic-banner-heading" className="font-display text-lg font-semibold text-text">
          {BOOK.title}
        </h2>
        <p className="text-sub">{BOOK.blurb[0]}</p>
        <Actions
          primary={{ href: BOOK_PATH, label: "About the book" }}
          secondary={{ href: COMICS_ROUTE, label: "Read the comics" }}
        />
      </div>
    </Card>
  );
}

interface Target {
  href: string;
  label: string;
}

function Actions({ primary, secondary }: { primary: Target; secondary: Target }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <Button asChild variant="toolkit">
        <Link href={primary.href} prefetch={false}>
          {primary.label}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={secondary.href} prefetch={false}>
          {secondary.label}
        </Link>
      </Button>
    </div>
  );
}
