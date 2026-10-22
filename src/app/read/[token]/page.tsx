import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COMIC_TITLE } from "@/lib/comic/agile-at-work";
import { isValidComicToken } from "@/lib/comic/access";
import { getComicSignedUrl } from "@/lib/comic/storage";
import { ComicClient } from "./comic-client";

/**
 * The "Agile at Work" reader. Its only way in is the private link
 * /comic/<token>, printed as a QR code; nothing on the site lists, links to
 * or indexes it. The middleware checks the token and rewrites the right one
 * to this route. This route's own URL is never served: the middleware
 * answers it with the ordinary 404.
 *
 * A wrong token never gets here. /comic/<wrong> matches no route, so it
 * gets the very 404 any unknown URL gets, and says nothing about whether a
 * guess was close. The token is still checked here, as defence in depth. A
 * right one gets a fresh signed URL for the private PDF on every request:
 * nothing here may be cached or prerendered.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: { token: string } };

const description = "Read the Agile at Work comic.";

// Never indexed, and never leaks the token through a Referer header. No
// canonical and no openGraph `url`, so the token never lands in a meta tag.
// openGraph and twitter replace the root blocks wholesale, so they repeat
// type and siteName.
const comicMetadata: Metadata = {
  title: COMIC_TITLE,
  description,
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, nocache: true },
  },
  referrer: "no-referrer",
  openGraph: {
    type: "website",
    siteName: "Agile Toolkit",
    title: COMIC_TITLE,
    description,
  },
  twitter: {
    card: "summary",
    title: COMIC_TITLE,
    description,
  },
};

/** The comic's metadata for the right token only; anything else keeps the layout's. */
export function generateMetadata({ params }: Props): Metadata {
  return isValidComicToken(params.token) ? comicMetadata : {};
}

export default async function ComicPage({ params }: Props) {
  if (!isValidComicToken(params.token)) notFound();
  const source = await getComicSignedUrl();
  return <ComicClient source={source} />;
}
