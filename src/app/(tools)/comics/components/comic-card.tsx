import Link from "next/link";
import { Card } from "@/components/ui/card";
import { COMICS_ROUTE, comicHref } from "@/lib/comics/entry";
import { panelImageUrl } from "@/lib/comics/images";
import type { StoryCover, StorySummary } from "@/lib/comics/types";

/**
 * A story's first panel at 768 px, loaded only when it nears the screen. The
 * card's title names the link, so the picture itself has no text alternative.
 */
export function ComicCover({ cover }: { cover: StoryCover }) {
  return (
    // Plain <img>: the art is already sized, and the optimiser would add a
    // second copy of every panel to the download bill.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={panelImageUrl(cover.pathSmall)}
      width={cover.width}
      height={cover.height}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-auto w-full bg-surface"
    />
  );
}

export function ComicCard({
  story,
  href = comicHref(story.ep),
  note,
}: {
  story: StorySummary;
  /** Where the card goes: the public story unless a page says otherwise. */
  href?: string;
  /** A short line under the lesson, like when an early story comes out. */
  note?: string;
}) {
  return (
    <li>
      <Card className="h-full overflow-hidden transition-colors hover:border-accent/40">
        <Link
          href={href}
          prefetch={false}
          className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {story.cover ? <ComicCover cover={story.cover} /> : null}
          <div className="p-4">
            <h3 className="font-semibold text-text">{story.title}</h3>
            <p className="mt-1 line-clamp-3 text-sm text-sub">{story.lesson}</p>
            {note ? <p className="mt-2 text-xs font-medium text-sub">{note}</p> : null}
          </div>
        </Link>
      </Card>
    </li>
  );
}

/** The newest weekly stories, under a poster's episode. */
export function LatestComics({ stories }: { stories: readonly StorySummary[] }) {
  if (stories.length === 0) return null;
  return (
    <section aria-labelledby="latest-comics-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="latest-comics-heading" className="font-display text-lg font-semibold text-text">
          The latest comics
        </h2>
        <Link
          href={COMICS_ROUTE}
          prefetch={false}
          className="text-sm font-medium text-text underline"
        >
          See all comics
        </Link>
      </div>
      <ul className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((story) => (
          <ComicCard key={story.ep} story={story} />
        ))}
      </ul>
    </section>
  );
}
