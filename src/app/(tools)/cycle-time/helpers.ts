/**
 * Cycle Time Analyzer — pure stats/date helpers + histogram buckets. No React.
 */

// R5: `new Date("YYYY-MM-DD")` parses as UTC midnight; subtracting two
// UTC midnights and dividing by 86_400_000 SHOULD be exact, but if the
// input is `YYYY-MM-DDTHH:mm` (datetime-local), the parse is in LOCAL
// time. Mixing the two formats produces a tz-offset-shifted delta that
// rounds the wrong way at DST transitions. Parse as local-date when
// the string matches the date-only shape, else parse as-is.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseLocalOrIso(s: string): number {
  if (DATE_ONLY.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(s).getTime();
}

export function calcCycleTime(start: string, end: string): number | null {
  if (!start || !end) return null;
  const s = parseLocalOrIso(start);
  const e = parseLocalOrIso(end);
  if (isNaN(s) || isNaN(e) || e < s) return null;
  return Math.round((e - s) / (1000 * 60 * 60 * 24));
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((sorted.length * p) / 100) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function round(v: number, d = 1) {
  return Math.round(v * 10 ** d) / 10 ** d;
}

export const BUCKETS: { label: string; min: number; max: number }[] = [
  // Includes 0 in the "1 day" bucket so same-day tasks (start === end,
  // cycle time = 0) aren't silently dropped from the histogram while
  // still counted in the "X / Y with cycle time" stats line. Without
  // the min:0 lower bound, a workspace where every task closes on the
  // same day showed an empty histogram + a non-zero N — a visible
  // contradiction.
  // BUG-T2-cycle-time-1: use the unicode "≤" character. SVG <text>
  // doesn't interpret HTML entities; the chart axis was rendering the
  // literal "&le;1 day".
  { label: "≤1 day", min: 0, max: 1 },
  { label: "2 days", min: 2, max: 2 },
  { label: "3-4 days", min: 3, max: 4 },
  { label: "5-7 days", min: 5, max: 7 },
  { label: "8-14 days", min: 8, max: 14 },
  { label: "15+ days", min: 15, max: Infinity },
];

export const PERCENTILE_KEYS = [50, 75, 85, 90, 95, 99] as const;
