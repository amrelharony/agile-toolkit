import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  BOOK_SHARE_URL,
  COVER_SIZE,
  COVER_SMALL_SIZE,
  COVER_SMALL_URL,
  COVER_URL,
} from "@/lib/book/art";
import { BOOK, BOOK_PATH, bookJsonLd } from "@/lib/book/book";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";
import { COMICS_ROUTE } from "@/lib/comics/entry";
import { SITE_URL, jsonLdScript } from "@/lib/comics/rights";
import { comicMetadata } from "../comics/comic-metadata";
import { bookArt } from "@/lib/ink/drawings/pages/book";

export const metadata: Metadata = comicMetadata({
  title: `${BOOK.title} — the book`,
  description: BOOK.blurb[0],
  canonical: BOOK_PATH,
  image: `${SITE_URL}${BOOK_SHARE_URL}`,
});

/**
 * /book: the printed book, in the words of its cover, with the 26 episodes and
 * the page each starts on. The episodes aren't links: the book's stories stay
 * out of the gallery, and a poster is the way to one. Static, with nothing to
 * read but this file, so it's the same for every visitor.
 */
export default function BookPage() {
  return (
    <ToolPageWrapper
      art={bookArt}
      title={BOOK.title}
      description={`${BOOK.subtitle}, by ${BOOK.author}`}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(bookJsonLd()) }}
      />
      <div className="space-y-6">
        <Card className="grid overflow-hidden md:grid-cols-[minmax(0,22rem)_1fr]">
          {/* Plain <img>: the cover is already sized, at two widths. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={COVER_URL}
            srcSet={`${COVER_SMALL_URL} ${COVER_SMALL_SIZE}w, ${COVER_URL} ${COVER_SIZE}w`}
            sizes="(min-width: 768px) 22rem, 100vw"
            width={COVER_SIZE}
            height={COVER_SIZE}
            alt="The front cover: Amr at work in a Cairo office with three of his colleagues"
            fetchPriority="high"
            decoding="async"
            className="h-auto w-full bg-surface"
          />
          <div className="space-y-3 p-4 sm:p-6">
            <Eyebrow>{BOOK.volume}</Eyebrow>
            <h2 className="font-display text-xl font-semibold text-text">{BOOK.tagline}</h2>
            {BOOK.blurb.map((paragraph) => (
              <p key={paragraph} className="text-sub">
                {paragraph}
              </p>
            ))}
            <Button asChild variant="toolkit">
              <Link href={COMICS_ROUTE}>
                Read the comics
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <p className="text-sm text-sub">
              Have the book? Scan the QR code inside it to open the tools for its readers.
            </p>
            <p className="text-sm text-sub">ISBN {BOOK.isbn}</p>
          </div>
        </Card>

        <section aria-labelledby="contents-heading" className="space-y-3">
          <h2 id="contents-heading" className="font-display text-lg font-semibold text-text">
            Inside the book
          </h2>
          <Card>
            <CardContent className="p-4 sm:p-6">
              <ol className="grid list-none gap-x-8 gap-y-2 md:grid-cols-2">
                {BOOK_EPISODES.map((episode) => (
                  <li key={episode.ep} className="flex items-baseline gap-3">
                    <span className="w-6 shrink-0 text-right text-sm tabular-nums text-sub">
                      {episode.ep}
                    </span>
                    <span className="min-w-0 flex-1 text-text">{episode.title}</span>
                    <span className="shrink-0 text-sm tabular-nums text-sub">
                      page {episode.bookPage}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="author-heading" className="space-y-3">
          <h2 id="author-heading" className="font-display text-lg font-semibold text-text">
            About the author
          </h2>
          <Card>
            <CardContent className="space-y-1 p-4 sm:p-6">
              <p className="font-semibold text-text">{BOOK.author}</p>
              <p className="text-sub">{BOOK.authorBio}</p>
            </CardContent>
          </Card>
        </section>
      </div>
    </ToolPageWrapper>
  );
}
