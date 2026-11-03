/**
 * How a comic URL maps to a page. Pure and edge-safe: the middleware runs
 * this on every /comics request, so it must never import Supabase or do I/O.
 *
 * Every comic is /comics?ep=NN and a poster adds &b=NN. The numbers are printed
 * on 260 posters, zero padded, so those links can never change. A valid number
 * is rewritten to a static page behind the same address; anything else stays
 * the normal /comics page.
 */

/** Episodes 1-26 are the printed book, and weekly stories continue from 27. */
export const BOOK_EPISODE_COUNT = 26;
export const FIRST_WEEKLY_EP = BOOK_EPISODE_COUNT + 1;
export const COMICS_ROUTE = "/comics";
/** Next four weeks' stories, for book readers. Never rewritten: only exactly /comics is. */
export const EARLY_COMICS_ROUTE = "/comics/early";

/** 1-999, with one optional leading zero below 10: "7", "07" and "126", never "007". */
export const EP_PATTERN = /^(?:0?[1-9]|[1-9]\d{1,2})$/;
/** Buildings 1-10, padded like the poster links. */
export const BUILDING_PATTERN = /^(?:0?[1-9]|10)$/;

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

export function parseBuilding(raw: Raw): number | null {
  const value = single(raw);
  return value !== null && BUILDING_PATTERN.test(value) ? Number(value) : null;
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

/** The static page behind /comics?ep=NN, or null to leave the normal /comics. */
export function comicRewritePath(params: URLSearchParams): string | null {
  const ep = parseEp(params.getAll("ep"));
  if (ep === null) return null;
  if (isBookEp(ep) && parseBuilding(params.getAll("b")) !== null) {
    return `${COMICS_ROUTE}/poster/${ep}`;
  }
  return `${COMICS_ROUTE}/ep/${ep}`;
}

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
