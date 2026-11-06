/**
 * The print campaign's anonymous visit count: what a page may record about an
 * arrival, which printed piece brought it, and how the browser sends it.
 *
 * A visit is a page (/comics or /kudos), a source (lib/comics/entry's
 * arrivalSource: poster, kudos, book, sign, guide, comics or none) and an
 * episode, 0 for none. The server adds it to this month's total and keeps
 * nothing else, and the browser keeps nothing at all. The same rules decide
 * what the browser sends (visitFor) and what the route accepts (parseVisit), so
 * an allowlist, not free text, is all that can reach the table.
 *
 * Pure apart from sendVisit and isFreshArrival, which only run in a browser.
 */

import { arrivalSource, isBookEp, parseEp, type ArrivalSource } from "./entry";

export const VISIT_PATHS = ["/comics", "/kudos"] as const;
export type VisitPath = (typeof VISIT_PATHS)[number];

export interface Visit {
  path: VisitPath;
  src: ArrivalSource;
  /** The episode, or 0 for none. */
  ep: number;
}

/** Which printed pieces lead to each page, as the campaign prints them. */
const SOURCES_FOR: Record<VisitPath, readonly ArrivalSource[]> = {
  "/comics": ["poster", "kudos", "book", "none"],
  "/kudos": ["sign", "guide", "comics", "none"],
};

/** Whether the counter may record `visit`. */
export function isValidVisit(visit: Visit): boolean {
  const { path, src, ep } = visit;
  if (!SOURCES_FOR[path]?.includes(src)) return false;
  if (!Number.isInteger(ep) || ep < 0 || ep > 999) return false;
  // A poster is always one episode's; a kudos card is an episode's or an open one.
  if (src === "poster") return isBookEp(ep);
  if (src === "kudos") return ep === 0 || isBookEp(ep);
  if (src === "book") return ep === 0;
  // On /kudos an episode opens its printed card, so only the book's count there.
  if (path === "/kudos") return ep === 0 || isBookEp(ep);
  return true;
}

/**
 * The visit an address records: always one the counter accepts. The printed
 * piece comes first, so an episode it can't carry is dropped before the piece
 * is; a piece that doesn't belong on this page counts as "none", with the
 * episode if that can keep it.
 */
export function visitFor(path: VisitPath, params: URLSearchParams): Visit {
  const ep = parseEp(params.getAll("ep")) ?? 0;
  const src = arrivalSource(params);
  const tries: Visit[] = [
    { path, src, ep },
    { path, src, ep: 0 },
    { path, src: "none", ep },
  ];
  return tries.find(isValidVisit) ?? { path, src: "none", ep: 0 };
}

/** What the counter route accepts: exactly a valid visit, and nothing besides. */
export function parseVisit(body: unknown): Visit | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { path, src, ep, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (typeof path !== "string" || typeof src !== "string" || typeof ep !== "number") return null;
  if (!(VISIT_PATHS as readonly string[]).includes(path)) return null;
  const visit = { path, src, ep } as Visit;
  return isValidVisit(visit) ? visit : null;
}

const ENDPOINT = "/api/comics/hit";

/** Send one count, without waiting for or reading an answer. Returns whether it went. */
export function sendVisit(visit: Visit): boolean {
  if (typeof navigator.sendBeacon !== "function") return false;
  const body = new Blob([JSON.stringify(visit)], { type: "application/json" });
  return navigator.sendBeacon(ENDPOINT, body);
}

/**
 * Whether this page load is someone arriving at `path` (with `params`) from
 * outside the site: a document that began at this page and episode, not a
 * reload or a step back or forward, and not one this site opened. A client
 * navigation keeps the first page's document, so it never is one.
 */
export function isFreshArrival(path: VisitPath, params: URLSearchParams): boolean {
  const [navigation] = (performance.getEntriesByType?.("navigation") ??
    []) as PerformanceNavigationTiming[];
  const began = navigation ? new URL(navigation.name) : new URL(window.location.href);
  if (navigation && (navigation.type === "reload" || navigation.type === "back_forward")) {
    return false;
  }
  if (began.pathname !== path) return false;
  // /comics is every comic: the document began at this one only if the episode matches.
  if (parseEp(began.searchParams.getAll("ep")) !== parseEp(params.getAll("ep"))) return false;
  if (!document.referrer) return true;
  try {
    return new URL(document.referrer).hostname !== window.location.hostname;
  } catch {
    return true;
  }
}
