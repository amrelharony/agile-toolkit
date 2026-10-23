/**
 * Day labels for dependency due dates, shared by the Dependency Map, PI
 * Planning and Scrum of Scrums so "due 2 Nov" reads the same everywhere.
 *
 * Due dates are stored as YYYY-MM-DD with no time zone. `new Date("2026-11-02")`
 * parses as UTC midnight, which shows as 1 Nov west of Greenwich, so the
 * parts are read as a local date instead.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The local date for a YYYY-MM-DD string, or null when it isn't one. */
export function parseDay(iso: string | undefined): Date | null {
  const m = iso ? DAY.exec(iso) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2 Nov" (or "2 Nov 2026" with `withYear`); the raw text for a malformed date. */
export function dayLabel(iso: string | undefined, withYear = false): string {
  const d = parseDay(iso);
  if (!d) return iso ?? "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** YYYY-MM-DD for a local date, `days` from `from`. */
export function dayFrom(from: Date, days: number): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Whole days from `iso` to `today` (both YYYY-MM-DD); null for a malformed date. */
export function daysBetween(iso: string | undefined, today: string): number | null {
  const a = parseDay(iso);
  const b = parseDay(today);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
