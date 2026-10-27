/**
 * Calendar periods for the tools that chart dated items by week, month or
 * quarter: NPS / CSAT's weekly or monthly scores, Flaky Tests' new flakies
 * per week, Code Review's weekly median, Quality Cost's quarters. One
 * reading for every page and agent action, so a week starts on the same
 * Monday everywhere and a quiet period shows as empty instead of vanishing
 * (a series with its gaps left out reads a stall as steady).
 *
 * Periods are labelled "2026-W42" (ISO week, the year of its Thursday, as
 * lib/flow/throughput's weekOf), "2026-10" and "2026-Q4" (the dash quarter
 * lib/roadmap/quarters writes). Days are local calendar days: a timestamp
 * is read as its local day (lib/flow/days), then stepped as a day number,
 * so no time zone or daylight-saving change moves one. Pure; server-safe.
 */

import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { dayNumber } from "@/lib/flow/days";
import { weekOf } from "@/lib/flow/throughput";
import { dashQuarter, quarterBounds, quarterIndex } from "@/lib/roadmap/quarters";

export type PeriodKind = "week" | "month" | "quarter";

export const PERIOD_KINDS: readonly PeriodKind[] = ["week", "month", "quarter"];

/**
 * At most this many periods in one range (about 19 years of weeks), the
 * latest kept: a corrupt far-past date can't build a huge series.
 */
export const MAX_PERIODS = 1000;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 0 = Sunday … 6 = Saturday for a UTC day number (day 0 was a Thursday). */
const weekdayOf = (n: number) => (((n + 4) % 7) + 7) % 7;

/** A period as its kind and its position: a week's Monday day number, a month's or quarter's count. */
interface Parsed {
  kind: PeriodKind;
  ord: number;
}

/** The Monday (as a day number) of ISO week `week` of `year`, or null when that week doesn't exist. */
function mondayOfWeek(year: number, week: number): number | null {
  const jan4 = isoDayNumber(`${year}-01-04`);
  if (jan4 === null || week < 1 || week > 53) return null;
  // Week 1 is the week holding 4 January; its Monday is that day's Monday.
  const monday = jan4 - ((weekdayOf(jan4) + 6) % 7) + (week - 1) * 7;
  // Week 53 exists only in long years: it must read back as itself.
  return weekOf(isoFromDayNumber(monday)) === `${year}-W${pad2(week)}` ? monday : null;
}

function parsePeriod(period: string): Parsed | null {
  const week = /^(\d{4})-W(\d{2})$/.exec(period);
  if (week) {
    const monday = mondayOfWeek(Number(week[1]), Number(week[2]));
    return monday === null ? null : { kind: "week", ord: monday };
  }
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) {
    const m = Number(month[2]);
    return m >= 1 && m <= 12 ? { kind: "month", ord: Number(month[1]) * 12 + (m - 1) } : null;
  }
  if (/^\d{4}[\s-]*Q[1-4]$/i.test(period.trim())) {
    const q = quarterIndex(period);
    return q === 0 ? null : { kind: "quarter", ord: q };
  }
  return null;
}

function labelOf(ord: number, kind: PeriodKind): string {
  if (kind === "week") return weekOf(isoFromDayNumber(ord)) as string;
  if (kind === "month") return `${Math.floor(ord / 12)}-${pad2((ord % 12) + 1)}`;
  return dashQuarter(ord);
}

/** How far one period steps its position. */
const stepOf = (kind: PeriodKind) => (kind === "week" ? 7 : 1);

/**
 * The period ("2026-W42" | "2026-10" | "2026-Q4") a local day or timestamp
 * falls in, or null when it isn't a date.
 */
export function periodOf(day: string | null | undefined, kind: PeriodKind): string | null {
  const n = dayNumber(day);
  if (n === null) return null;
  const iso = isoFromDayNumber(n);
  if (kind === "week") return weekOf(iso);
  if (kind === "month") return iso.slice(0, 7);
  const month = Number(iso.slice(5, 7));
  return `${iso.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/** The kind of a period label, or null when it isn't one ("2026 Q4" reads as a quarter). */
export function periodKindOf(period: string | null | undefined): PeriodKind | null {
  return typeof period === "string" ? (parsePeriod(period)?.kind ?? null) : null;
}

/**
 * A period's position for `kind`: from its label, or from a day inside it.
 * A label of another kind is null, never read as a date.
 */
function positionOf(value: string, kind: PeriodKind): number | null {
  const parsed = parsePeriod(value);
  if (parsed) return parsed.kind === kind ? parsed.ord : null;
  const period = periodOf(value, kind);
  return period === null ? null : (parsePeriod(period)?.ord ?? null);
}

/**
 * Every period from `from` to `to`, both included, oldest first and with no
 * gaps. Each end is a period label of `kind` or a day inside one. At most
 * `cap` (and MAX_PERIODS) periods, the latest kept, since the recent end is
 * the one a chart is read for. Empty when either end can't be read or `to`
 * comes first.
 */
export function periodRange(
  from: string,
  to: string,
  kind: PeriodKind,
  cap: number = MAX_PERIODS
): string[] {
  const a = positionOf(from, kind);
  const b = positionOf(to, kind);
  if (a === null || b === null || b < a) return [];
  const step = stepOf(kind);
  // A cap below 1 still keeps the latest period; a non-number is no cap.
  const limit = Number.isFinite(cap)
    ? Math.min(MAX_PERIODS, Math.max(1, Math.floor(cap)))
    : MAX_PERIODS;
  const count = Math.min((b - a) / step + 1, limit);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(labelOf(b - i * step, kind));
  return out;
}

/**
 * Items grouped by period, from the first item's period to the last's,
 * oldest first, with the periods in between kept as `items: []`. Items
 * without a date (`dayOf` gives null or a non-date) are left out; count
 * them separately when the page says so. Capped as `periodRange`: items in
 * the periods it drops are dropped with them.
 */
export function bucketByPeriod<T>(
  items: readonly T[],
  dayOf: (item: T) => string | null | undefined,
  kind: PeriodKind,
  cap: number = MAX_PERIODS
): { period: string; items: T[] }[] {
  const byPeriod = new Map<string, T[]>();
  let first: number | null = null;
  let last: number | null = null;
  for (const item of items) {
    const period = periodOf(dayOf(item), kind);
    if (period === null) continue;
    const ord = parsePeriod(period)?.ord;
    if (ord === undefined) continue;
    if (first === null || ord < first) first = ord;
    if (last === null || ord > last) last = ord;
    const list = byPeriod.get(period);
    if (list) list.push(item);
    else byPeriod.set(period, [item]);
  }
  if (first === null || last === null) return [];
  return periodRange(labelOf(first, kind), labelOf(last, kind), kind, cap).map((period) => ({
    period,
    items: byPeriod.get(period) ?? [],
  }));
}

/** The first and last local day ("YYYY-MM-DD") of a period, or null when it isn't one. */
export function periodBounds(period: string): { from: string; to: string } | null {
  const parsed = parsePeriod(period);
  if (!parsed) return null;
  if (parsed.kind === "week") {
    return { from: isoFromDayNumber(parsed.ord), to: isoFromDayNumber(parsed.ord + 6) };
  }
  if (parsed.kind === "month") {
    const year = Math.floor(parsed.ord / 12);
    const month = (parsed.ord % 12) + 1;
    // Day 0 of the next month is this month's last day.
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: `${year}-${pad2(month)}-01`, to: `${year}-${pad2(month)}-${pad2(last)}` };
  }
  const bounds = quarterBounds(dashQuarter(parsed.ord));
  return bounds ? { from: bounds.start, to: bounds.end } : null;
}

/**
 * Oldest first, by the day each period starts (then the shorter one, so a
 * week sorts before the month starting the same day). A label that isn't a
 * period sorts after the readable ones, by its text.
 */
export function comparePeriods(a: string, b: string): number {
  const ba = periodBounds(a);
  const bb = periodBounds(b);
  if (ba === null || bb === null) {
    if (ba !== null) return -1;
    if (bb !== null) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const start = (isoDayNumber(ba.from) as number) - (isoDayNumber(bb.from) as number);
  if (start !== 0) return start;
  return (isoDayNumber(ba.to) as number) - (isoDayNumber(bb.to) as number);
}

/** A period as people read it: "Week 42, 2026", "Oct 2026", "Q4 2026"; anything else as given. */
export function periodLabel(period: string): string {
  const parsed = parsePeriod(period);
  if (!parsed) return period;
  if (parsed.kind === "week") {
    const label = weekOf(isoFromDayNumber(parsed.ord)) as string;
    return `Week ${Number(label.slice(6))}, ${label.slice(0, 4)}`;
  }
  if (parsed.kind === "month") {
    return `${MONTHS[parsed.ord % 12]} ${Math.floor(parsed.ord / 12)}`;
  }
  const dash = dashQuarter(parsed.ord);
  return `${dash.slice(5)} ${dash.slice(0, 4)}`;
}
