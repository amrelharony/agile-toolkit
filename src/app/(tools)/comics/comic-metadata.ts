import type { Metadata } from "next";

interface ComicMetadataOptions {
  title: string;
  description: string;
  /** The public address, never the internal page behind the rewrite. */
  canonical?: string;
  /** Book episodes and "coming soon" pages stay out of search. */
  index?: boolean;
  /** A released story's share image, as a full URL. */
  image?: string | null;
}

/**
 * Metadata for every comics page. `other` asks image and text scrapers to leave
 * the art alone, which only the ones that follow the rules will do.
 */
export function comicMetadata({
  title,
  description,
  canonical,
  index = true,
  image,
}: ComicMetadataOptions): Metadata {
  const images = image ? [image] : undefined;
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
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description,
      ...(images ? { images } : {}),
    },
    other: { robots: "noai, noimageai" },
  };
}
