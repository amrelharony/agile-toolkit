/**
 * Which routes belong to the owner.
 *
 * The site is public: every tool page works for a signed-out visitor, with
 * their data kept in the browser. What stays owner-only is the server side
 * (every /api/* route the middleware does not bypass) plus the few pages
 * whose only purpose is managing those owner APIs.
 *
 * Pure and edge-safe — the middleware imports it, and so can client UI that
 * needs to know whether the current page would bounce a visitor.
 */

/** Pages that exist only to manage owner-only APIs. Matched with their subpaths. */
export const OWNER_ONLY_PAGES: readonly string[] = ["/settings/access-tokens", "/settings/squads"];

export type RouteKind = "api" | "owner-page" | "public-page";

export function routeKind(pathname: string): RouteKind {
  // Lowercased so `/API/kudos` cannot slip past the API classification and
  // be treated as a page (which fails open). The owner-page check gets the
  // same treatment for the same reason: failing closed on a case variant is
  // harmless, failing open is not.
  const p = pathname.toLowerCase();
  if (p === "/api" || p.startsWith("/api/")) return "api";
  if (OWNER_ONLY_PAGES.some((page) => p === page || p.startsWith(`${page}/`))) {
    return "owner-page";
  }
  return "public-page";
}

export function isOwnerOnlyPage(pathname: string): boolean {
  return routeKind(pathname) === "owner-page";
}
