/**
 * The printed book, in its own words: everything here is copied from the
 * printer's cover proof (Agile_At_Work_Cover_Printer_Proof_300PPI.pdf), so
 * don't edit it here. The episodes and their pages are in lib/comics/book-episodes.
 */

import { COPYRIGHT_NOTICE, SITE_URL } from "@/lib/comics/rights";
import { COVER_SIZE, COVER_URL } from "./art";

export const BOOK_PATH = "/book";

export const BOOK = {
  title: "Agile at Work",
  /** Under the title on the front cover. */
  subtitle: "26 Stories About Working Better Together",
  volume: "Volume 1",
  author: "Amr Elharony",
  /** The back cover's headline. */
  tagline: "Every team has its characters.",
  /** The back cover's two paragraphs. */
  blurb: [
    "In a fictional Cairo workplace, competing priorities, circular approvals and busy colleagues make getting things done surprisingly complicated.",
    "Across 26 comic stories, Amr and a memorable cast turn everyday challenges into humour, reflection and practical conversations about working better together.",
  ],
  /** "About the author" on the back cover. */
  authorBio:
    "Amr Elharony is an agile delivery leader and mentor who connects business and technology. Founder of Fintech Bilinguals and author of The Bilingual Executive Series, he brings everyday workplace challenges to life through humour.",
  isbn: "978-977-95-9064-6",
} as const;

/** The ISBN as structured data wants it, digits only. */
export const BOOK_ISBN_DIGITS = BOOK.isbn.replace(/-/g, "");

/** schema.org Book for /book: what the cover says, and the front cover itself. */
export function bookJsonLd(): Record<string, unknown> {
  const author = { "@type": "Person", name: BOOK.author };
  return {
    "@context": "https://schema.org",
    "@type": "Book",
    name: BOOK.title,
    alternativeHeadline: BOOK.subtitle,
    description: BOOK.blurb.join(" "),
    url: `${SITE_URL}${BOOK_PATH}`,
    isbn: BOOK_ISBN_DIGITS,
    inLanguage: "en",
    author,
    copyrightHolder: author,
    copyrightNotice: COPYRIGHT_NOTICE,
    image: {
      "@type": "ImageObject",
      contentUrl: `${SITE_URL}${COVER_URL}`,
      width: COVER_SIZE,
      height: COVER_SIZE,
      creditText: BOOK.author,
      copyrightNotice: COPYRIGHT_NOTICE,
    },
  };
}
