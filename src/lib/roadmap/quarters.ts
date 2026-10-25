/**
 * Quarters as the roadmap stores them: "2026 Q3". The agents' `add_epic`
 * takes the same free text, so parsing stays lenient ("2026q3", "2026 q3",
 * and the DORA Scorecard's "2026-Q3") while everything the tool writes is
 * the canonical label. The DORA Scorecard stores the dash form
 * (`dashQuarter`) and reads a quarter's days with `quarterBounds`.
 *
 * A quarter's index is `year * 4 + q` with q in 1..4, so 0 can mean
 * "unparsable". Decoding subtracts 1 first: the earlier `floor(i / 4)`
 * attributed every Q4 to the following year (2026 Q4 = 8108 = 2027 × 4).
 */

/** At most this many quarter columns (10 years); a pasted "9999 Q4" froze the tab. */
export const MAX_QUARTERS_SPAN = 40;

/** Years either side of now that the pickers offer (stored quarters outside are added). */
const YEARS_BACK = 2;
const YEARS_AHEAD = 5;
/** The furthest back a picker may be asked to reach (`yearsBack`). */
const MAX_YEARS_BACK = 20;

/** The quarter's index, or 0 when it isn't a "YYYY Qn" (or "YYYY-Qn") between 1900 and 2200. */
export function quarterIndex(q: string | null | undefined): number {
  const m = typeof q === "string" ? q.match(/(\d{4})[\s-]*Q([1-4])/i) : null;
  if (!m) return 0;
  const year = parseInt(m[1], 10);
  // A hand-edited "0 Q1" (or "9999 Q1") must not pass as a real quarter.
  if (year < 1900 || year > 2200) return 0;
  return year * 4 + parseInt(m[2], 10);
}

/** "2026 Q3" for an index from `quarterIndex`. */
export function quarterLabel(index: number): string {
  const zero = index - 1;
  return `${Math.floor(zero / 4)} Q${(zero % 4) + 1}`;
}

/** "2026-Q3" for an index from `quarterIndex`: the form the DORA Scorecard stores. */
export function dashQuarter(index: number): string {
  const zero = index - 1;
  return `${Math.floor(zero / 4)}-Q${(zero % 4) + 1}`;
}

/**
 * Whether `q` is exactly a dash quarter ("2026-Q3") with a year from 1900 to
 * 2200. Stricter than `quarterIndex`, which also reads "2026-Q10" as Q1: a
 * store that sorts its quarters as text needs the exact form.
 */
export function isDashQuarter(q: unknown): q is string {
  return typeof q === "string" && /^\d{4}-Q[1-4]$/.test(q) && quarterIndex(q) !== 0;
}

/** The first and last day ("YYYY-MM-DD") of a quarter, or null when it can't be read. */
export function quarterBounds(q: string | null | undefined): { start: string; end: string } | null {
  const i = quarterIndex(q);
  if (i === 0) return null;
  const zero = i - 1;
  const year = Math.floor(zero / 4);
  const firstMonth = (zero % 4) * 3;
  const pad = (n: number) => String(n).padStart(2, "0");
  // Day 0 of the month after the quarter is the quarter's last day.
  const lastDay = new Date(Date.UTC(year, firstMonth + 3, 0)).getUTCDate();
  return {
    start: `${year}-${pad(firstMonth + 1)}-01`,
    end: `${year}-${pad(firstMonth + 3)}-${pad(lastDay)}`,
  };
}

/** The canonical label for a stored quarter, or "" when it can't be read. */
export function normalizeQuarter(q: string | null | undefined): string {
  const i = quarterIndex(q);
  return i === 0 ? "" : quarterLabel(i);
}

export function currentQuarterIndex(now: Date = new Date()): number {
  return now.getFullYear() * 4 + Math.floor(now.getMonth() / 3) + 1;
}

export function currentQuarter(now: Date = new Date()): string {
  return quarterLabel(currentQuarterIndex(now));
}

/** The quarter `n` quarters after `q` (before, for a negative `n`). */
export function shiftQuarter(q: string, n: number): string {
  const i = quarterIndex(q);
  return i === 0 ? "" : quarterLabel(i + n);
}

/** Quarters from `from` to `to` inclusive, capped at MAX_QUARTERS_SPAN; [] when either is invalid or reversed. */
export function quartersBetween(from: string, to: string): string[] {
  const start = quarterIndex(from);
  const end = quarterIndex(to);
  if (start === 0 || end === 0 || end < start) return [];
  const span = Math.min(end - start + 1, MAX_QUARTERS_SPAN);
  return Array.from({ length: span }, (_, k) => quarterLabel(start + k));
}

/** How many quarters `from`–`to` asks for, before the cap (0 when invalid). */
export function requestedSpan(from: string, to: string): number {
  const start = quarterIndex(from);
  const end = quarterIndex(to);
  return start === 0 || end === 0 || end < start ? 0 : end - start + 1;
}

/**
 * The quarters a picker offers, in order: a few years back to several
 * ahead, plus the whole year of any stored quarter (`also`) outside that,
 * so an old epic's dates still show as picked. Only those years are added,
 * not the gap to them, so a stray "1950 Q1" adds four options, not 300.
 * `yearsBack` reaches further back (the DORA Scorecard offers six years of
 * history to backdate), up to 20.
 */
export function quarterOptions(
  now: Date,
  also: readonly string[] = [],
  { yearsBack = YEARS_BACK }: { yearsBack?: number } = {}
): string[] {
  const year = now.getFullYear();
  const back =
    Number.isInteger(yearsBack) && yearsBack >= 0
      ? Math.min(yearsBack, MAX_YEARS_BACK)
      : YEARS_BACK;
  const years = new Set<number>();
  for (let y = year - back; y <= year + YEARS_AHEAD; y++) years.add(y);
  for (const q of also) {
    const i = quarterIndex(q);
    if (i !== 0) years.add(Math.floor((i - 1) / 4));
  }
  return Array.from(years)
    .sort((a, b) => a - b)
    .flatMap((y) => [1, 2, 3, 4].map((q) => `${y} Q${q}`));
}
