/**
 * The book's front cover and the site's share images, committed under
 * public/media with the first 8 hex chars of their SHA-256 in the name, so
 * next.config.mjs can serve /media/* with a year-long immutable cache.
 *
 * scripts/render-book-art.py makes all four from the printer's cover proof: the
 * cover is the proof's front cover cut at its trim, and the share images are
 * lettered in the site's own fonts. To replace one, run the script, paste the
 * names it prints here and delete the old files (test/book/art.test.ts checks
 * each name matches its bytes, and that nothing else is in the folder).
 *
 * Only the front cover is here, never the back: its author photo and barcode
 * stay on paper.
 */

/** The front cover, square like the printed book. */
export const COVER_SIZE = 1080;
export const COVER_URL = "/media/cover-1080.5f45323b.webp";
/** Half the size, for the book intro and the home page's card. */
export const COVER_SMALL_SIZE = 540;
export const COVER_SMALL_URL = "/media/cover-540.79ec4d70.webp";

/** 1200 x 630, the size link previews ask for. */
export const SHARE_SIZE = { width: 1200, height: 630 } as const;
/** The book's cover beside its title, for /book and the comics without a story. */
export const BOOK_SHARE_URL = "/media/share-book.a53dc6d5.jpg";
/** Amr waving beside the toolkit's name, for every other page. */
export const SITE_SHARE_URL = "/media/share-site.2525b046.jpg";
