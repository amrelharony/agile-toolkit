"use client";

import { OnSearchParams, dropSearchParams } from "@/components/shared/on-search-params";
import { arrivalSource } from "@/lib/comics/entry";
import { isFreshArrival, sendVisit, visitFor, type VisitPath } from "@/lib/comics/visits";

/**
 * What this page load has counted. Module state, so it lasts the document
 * across client navigations and a remount: at most one arrival with no printed
 * piece, and each printed address once.
 */
const counted = { arrival: false, addresses: new Set<string>() };

/** For tests, which load the module once: forget what this "page load" counted. */
export function forgetCountedVisits(): void {
  counted.arrival = false;
  counted.addresses.clear();
}

/**
 * Count this visit, at most once. An address naming a printed piece is counted
 * whenever it's opened, a client navigation to /kudos?src=comics included, and
 * then loses `src` (and the old `b`), so a shared or reloaded link isn't another
 * scan. Anything else is counted only as a fresh arrival: the first page of a
 * load that began here, not a reload, a step back or another page of the site.
 */
export function recordVisit(path: VisitPath, params: URLSearchParams): void {
  if (arrivalSource(params) !== "none") {
    const address = `${path}?${params.toString()}`;
    if (!counted.addresses.has(address)) {
      counted.addresses.add(address);
      counted.arrival = true;
      sendVisit(visitFor(path, params));
    }
    dropSearchParams(["src", "b"]);
    return;
  }
  if (counted.arrival) return;
  counted.arrival = true;
  if (isFreshArrival(path)) sendVisit(visitFor(path, params));
}

/**
 * The anonymous count, on /comics, an episode's page and /kudos. It listens to
 * the query, so it hears a client navigation too, and runs after the app
 * router is ready, so tidying the address bar sticks.
 */
export function VisitRecorder({ path }: { path: VisitPath }) {
  return <OnSearchParams onChange={(params) => recordVisit(path, params)} />;
}

/** Says what the count does, wherever one is on the page. */
export function CountDisclosure() {
  return (
    <p className="text-xs text-sub">
      This page sends us one anonymous count when you arrive: which printed piece brought you here,
      if any, and the episode. Nothing about you is kept: no cookies, nothing stored in your
      browser, and no IP address. The link is then tidied, so sharing it doesn&apos;t count again.
    </p>
  );
}
