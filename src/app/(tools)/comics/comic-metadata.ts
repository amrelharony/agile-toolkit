import type { Metadata } from "next";
import { BOOK_SHARE_URL } from "@/lib/book/art";
import { SITE_URL } from "@/lib/comics/rights";

interface ComicMetadataOptions {
  title: string;
  description: string;
  /** The public address, never the internal page behind the rewrite. */
  canonical?: string;
  /** Book episodes and "coming soon" pages stay out of search. */
  index?: boolean;
  /** A released story's share image, as a full URL. Without one, the book's. */
  image?: string | null;
}

/** For a number that isn't one: the 404, with no canonical or og:url of its own. */
export const NOT_FOUND_METADATA: Metadata = {
  alternates: { canonical: null },
  openGraph: { type: "website", siteName: "Agile Toolkit" },
};

/**
 * Metadata for every comics page. `other` asks image and text scrapers to leave
 * the art alone, which only the ones that follow the rules will do. A page with
 * no story image of its own shares the book's.
 */
export function comicMetadata({
  title,
  description,
  canonical,
  index = true,
  image,
}: ComicMetadataOptions): Metadata {
  const images = [image ?? `${SITE_URL}${BOOK_SHARE_URL}`];
  return {
    title,
    description,
    alternates: {
      ...(canonical ? { canonical } : {}),
      types: { "application/rss+xml": "/comics/feed.xml" },
    },
    ...(index ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      type: "website",
      siteName: "Agile Toolkit",
      ...(canonical ? { url: canonical } : {}),
      title,
      description,
      images,
    },
    twitter: { card: "summary_large_image", title, description, images },
    other: { robots: "noai, noimageai" },
  };
}
