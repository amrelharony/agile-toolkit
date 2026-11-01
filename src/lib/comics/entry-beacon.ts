/**
 * The anonymous entry count, browser side. One beacon per device, per day, per
 * way in; the server keeps daily totals and nothing about who sent it.
 *
 * The mark lives under the `agile-toolkit:` prefix, so "Clear data on this
 * browser" removes it with the rest (lib/utils/clear-local-data).
 */

export type EntryHit = { entry: "poster"; ep: number; b: number } | { entry: "direct" };

const ENDPOINT = "/api/comics/hit";

function markKey(hit: EntryHit): string {
  const where = hit.entry === "poster" ? `:${hit.ep}:${hit.b}` : "";
  return `agile-toolkit:comics:entry:${hit.entry}${where}`;
}

/** Storage can throw in a private window or with site data blocked. */
function readMark(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeMark(key: string, day: string): void {
  try {
    localStorage.setItem(key, day);
  } catch {
    // No mark: at worst this device counts again on its next visit today.
  }
}

/** Send the count unless this device already sent it today. Returns whether it did. */
export function sendEntryBeacon(hit: EntryHit): boolean {
  if (typeof navigator.sendBeacon !== "function") return false;
  const key = markKey(hit);
  // UTC, the same day the server files the count under.
  const today = new Date().toISOString().slice(0, 10);
  if (readMark(key) === today) return false;
  const body = new Blob([JSON.stringify(hit)], { type: "application/json" });
  if (!navigator.sendBeacon(ENDPOINT, body)) return false;
  writeMark(key, today);
  return true;
}

/**
 * Whether this page load is someone arriving at the plain /comics address. Not
 * after moving around the site: a client navigation keeps the first page's
 * referrer and doesn't start a new document, so both have to be checked.
 */
export function isDirectArrival(): boolean {
  if (window.location.search !== "") return false;
  // The query counts: landing on a story and then opening "All comics" stays on
  // the path /comics, but this document began at /comics?ep=N.
  const [navigation] = performance.getEntriesByType?.("navigation") ?? [];
  if (navigation) {
    const started = new URL(navigation.name);
    if (started.pathname !== window.location.pathname || started.search !== "") return false;
  }
  if (!document.referrer) return true;
  try {
    return new URL(document.referrer).hostname !== window.location.hostname;
  } catch {
    return true;
  }
}
