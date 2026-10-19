/**
 * Text alternatives for charts: the shape of the "View as table" data and the
 * small wording helpers the per-tool summary builders share.
 *
 * Pure (no React, no Recharts), so a tool can build its chart's summary and
 * table on first render without loading the chart chunk.
 */

/** The rows behind a chart, shown as a real table by ChartCard / ChartFigure. */
export interface ChartTable {
  /** Column headers; the first column names each row (e.g. "Day", "Sprint"). */
  columns: string[];
  /** One array per row, in column order. Use NO_VALUE for a gap. */
  rows: (string | number)[][];
  /** Shown above the table; defaults to the chart's title. */
  caption?: string;
}

/** A chart's one-sentence summary plus its data as a table. */
export interface ChartText {
  summary: string;
  table: ChartTable;
}

/** A gap in a series (a day not logged, a sprint not rated). */
export const NO_VALUE = "—";

/** A number rounded to `digits` decimals, without trailing zeros: 6.60 → "6.6". */
export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return NO_VALUE;
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  // -0 reads as "0".
  return String(Object.is(r, -0) ? 0 : r);
}

/** A table cell: the rounded number, or NO_VALUE for null / undefined / NaN. */
export function cell(n: number | null | undefined, digits = 1): string | number {
  if (n === null || n === undefined || !Number.isFinite(n)) return NO_VALUE;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** "1 day", "3 days"; pass the plural for irregular words. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

/**
 * How a value moved: "rose from 2 to 5", "fell from 40 to 27", "stayed at 8".
 * `show` formats each number (e.g. `(v) => `${fmt(v)}%``).
 */
export function move(from: number, to: number, show: (v: number) => string = fmt): string {
  const a = show(from);
  const b = show(to);
  if (a === b) return `stayed at ${a}`;
  return `${to > from ? "rose" : "fell"} from ${a} to ${b}`;
}

/** "a, b and c". */
export function listAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Mean of the finite numbers, or null when there are none. */
export function mean(values: readonly (number | null | undefined)[]): number | null {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
