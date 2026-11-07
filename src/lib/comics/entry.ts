/**
 * How a comic URL maps to a page. Pure and edge-safe: the middleware runs
 * this on every /comics request, so it must never import Supabase or do I/O.
 *
 * Every comic is /comics?ep=NN. The print campaign's QR codes add which printed
 * piece they're on, as `src` (see PRINT_SOURCES), and print the numbers zero
 * padded, so `ep` and `src` can never be renamed. A valid number is rewritten to
 * a static page behind the same address, whatever else the address says;
 * anything else stays the normal /comics page, which lists the episodes.
 */

/** Episodes 1-26 are the printed book, and weekly stories continue from 27. */
export const BOOK_EPISODE_COUNT = 26;
export const FIRST_WEEKLY_EP = BOOK_EPISODE_COUNT + 1;
export const COMICS_ROUTE = "/comics";
/** Every story as a flashcard (comics/flashcards). */
export const FLASHCARDS_ROUTE = "/comics/flashcards";
/** Next four weeks' stories, for book readers. Never rewritten: only exactly /comics is. */
export const EARLY_COMICS_ROUTE = "/comics/early";

/** 1-999, with one optional leading zero below 10: "7", "07" and "126", never "007". */
export const EP_PATTERN = /^(?:0?[1-9]|[1-9]\d{1,2})$/;

/**
 * What a printed QR code says it's on, as `?src=`:
 * - poster: the 26 A2 posters (/comics?ep=NN&src=poster);
 * - kudos: the kudos cards, an episode's (/comics?ep=NN&src=kudos) or an open one (/comics?src=kudos);
 * - book: page 161 and the back cover (/comics?src=book);
 * - sign and guide: the kudos wall sign and the Scrum Master guide (/kudos?src=sign, ?src=guide);
 * - comics: not printed, the comic pages' own links to /kudos.
 */
export const PRINT_SOURCES = ["poster", "kudos", "book", "sign", "guide", "comics"] as const;
export type PrintSource = (typeof PRINT_SOURCES)[number];
/** Where a visit came from: a printed piece, or "none" for anything else. */
export type ArrivalSource = PrintSource | "none";

type Raw = string | readonly string[] | null | undefined;

/** A single value: `?ep=1&ep=2` is a repeat, which is junk rather than a choice. */
function single(raw: Raw): string | null {
  if (typeof raw === "string") return raw;
  return raw && raw.length === 1 ? raw[0] : null;
}

export function parseEp(raw: Raw): number | null {
  const value = single(raw);
  return value !== null && EP_PATTERN.test(value) ? Number(value) : null;
}

/**
 * The printed piece an address names. A missing, unknown or repeated `src` is
 * "none". The building posters before the campaign printed `&b=NN` and no
 * `src`, so a `b` alone still means a poster; its number no longer matters.
 */
export function arrivalSource(params: URLSearchParams): ArrivalSource {
  const src = single(params.getAll("src"));
  if (src !== null && (PRINT_SOURCES as readonly string[]).includes(src)) return src as PrintSource;
  if (params.getAll("src").length === 0 && params.has("b")) return "poster";
  return "none";
}

export function isBookEp(ep: number): boolean {
  return ep >= 1 && ep <= BOOK_EPISODE_COUNT;
}

/** The public address of a comic. Internal pages always link to this form. */
export function comicHref(ep: number): string {
  return `${COMICS_ROUTE}?ep=${ep}`;
}

/** An unreleased story, for a book reader. Internal pages link here, never publicly. */
export function earlyComicHref(ep: number): string {
  return `${EARLY_COMICS_ROUTE}?ep=${ep}`;
}

/**
 * "Thank someone for this habit": the kudos form, opened on the episode's printed
 * card. Padded like the printed links, and `src` says it came from a comic page.
 */
export function thankSomeoneHref(ep: number): string {
  return `/kudos?ep=${String(ep).padStart(2, "0")}&src=comics`;
}

/**
 * The static page behind /comics?ep=NN, or null to leave the normal /comics.
 * Only `ep` decides: a poster, a kudos card and a shared link open the same page.
 */
export function comicRewritePath(params: URLSearchParams): string | null {
  const ep = parseEp(params.getAll("ep"));
  return ep === null ? null : `${COMICS_ROUTE}/ep/${ep}`;
}

/** comics/poster/N was the building posters' page; the address still goes home. */
const INTERNAL_PAGE = /^\/comics\/(?:ep|poster)\/([^/]+)$/;

/**
 * Where a direct visit to an internal page belongs, or null if `pathname` isn't
 * one. The rewrite happens inside the middleware and doesn't run it again, so
 * reaching this at all means someone typed or followed the internal path.
 */
export function comicInternalRedirect(pathname: string): string | null {
  const match = INTERNAL_PAGE.exec(pathname);
  if (!match) return null;
  const ep = parseEp(match[1]);
  return ep === null ? COMICS_ROUTE : comicHref(ep);
}

/** /comics or anything under it. */
export function isComicRoute(pathname: string | null | undefined): boolean {
  return !!pathname && (pathname === COMICS_ROUTE || pathname.startsWith(`${COMICS_ROUTE}/`));
}

/**
 * The path navigation should treat as current. A rewritten page is prerendered
 * at its internal path but hydrates at /comics, so the sidebar compares this
 * instead; otherwise the server's HTML and the browser's first render disagree.
 */
export function navPathname(pathname: string): string {
  return isComicRoute(pathname) ? COMICS_ROUTE : pathname;
}
