/**
 * Impediment Tracker: the page's pure pieces over `workspace.impediments`.
 * Status, age, due dates and order come from lib/impediments/model, so this
 * page, the cockpit and the agent actions read an impediment the same way;
 * what's here is the list filter, the weekly series behind the chart and
 * the wording the page and its export share. No React.
 *
 * Rows can come from agents and hand-offs as well as the form, so every
 * date is read through `dayOf` (an agent may write a full timestamp) and a
 * row with a bad date is skipped rather than allowed to poison a count.
 */

import type {
  Impediment,
  ImpedimentCategory,
  ImpedimentSeverity,
} from "@/lib/stores/workspace-types";
import {
  IMPEDIMENT_CATEGORIES,
  IMPEDIMENT_CATEGORY_LABEL,
  IMPEDIMENT_SEVERITIES,
  IMPEDIMENT_SEVERITY_LABEL,
  addDays,
  dayOf,
  daysBetween,
  impedimentAgeDays,
  impedimentStatus,
  isImpedimentOverdue,
} from "@/lib/impediments/model";
import { NO_VALUE, fmt, type ChartText } from "@/lib/charts/chart-text";

/* ── Wording ──────────────────────────────────────────────────────────── */

/** "1 day", "4 days". */
export const daysText = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * "19 Oct" (or "19 Oct 2026" with `withYear`) for a stored date. The day's
 * parts are read as a local date: `new Date("2026-10-19")` is UTC midnight,
 * which shows as the 18th west of Greenwich.
 */
export function dayLabel(value: string | undefined | null, withYear = false): string {
  const day = dayOf(value);
  if (!day) return NO_VALUE;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** Its title, or a stand-in for a row an agent wrote without one. */
export const titleOf = (i: Pick<Impediment, "title">) =>
  (typeof i.title === "string" && i.title.trim()) || "Untitled impediment";

export const isSeverity = (s: unknown): s is ImpedimentSeverity =>
  IMPEDIMENT_SEVERITIES.includes(s as ImpedimentSeverity);

export const isCategory = (c: unknown): c is ImpedimentCategory =>
  IMPEDIMENT_CATEGORIES.includes(c as ImpedimentCategory);

/** The severity's label; an unknown value (an agent's typo) shows as written. */
export const severityLabel = (s: string | undefined) =>
  isSeverity(s) ? IMPEDIMENT_SEVERITY_LABEL[s] : s || NO_VALUE;

export const categoryLabel = (c: string | undefined) =>
  isCategory(c) ? IMPEDIMENT_CATEGORY_LABEL[c] : c || "No category";

/**
 * The rows the page can show: anything without an id is dropped (it can't
 * be edited, resolved or deleted), the rest are kept exactly as stored.
 */
export function usableImpediments(list: readonly Impediment[] | undefined): Impediment[] {
  return (list ?? []).filter((i) => i && typeof i.id === "string" && i.id.length > 0);
}

/* ── Filtering ────────────────────────────────────────────────────────── */

/** The list's "Show" filter. Overdue cuts across open and escalated. */
export type StatusFilter = "all" | "open" | "escalated" | "overdue" | "resolved";

export interface ImpedimentFilters {
  status: StatusFilter;
  category: ImpedimentCategory | "all";
  severity: ImpedimentSeverity | "all";
}

export const NO_FILTERS: ImpedimentFilters = { status: "all", category: "all", severity: "all" };

export function matchesFilters(i: Impediment, f: ImpedimentFilters, today: string): boolean {
  if (f.category !== "all" && i.category !== f.category) return false;
  if (f.severity !== "all" && i.severity !== f.severity) return false;
  if (f.status === "all") return true;
  if (f.status === "overdue") return isImpedimentOverdue(i, today);
  return impedimentStatus(i) === f.status;
}

export const isFiltered = (f: ImpedimentFilters) =>
  f.status !== "all" || f.category !== "all" || f.severity !== "all";

/** How many each "Show" option would list, for the option labels. */
export function statusCounts(
  list: readonly Impediment[],
  today: string
): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    all: list.length,
    open: 0,
    escalated: 0,
    overdue: 0,
    resolved: 0,
  };
  for (const i of list) {
    counts[impedimentStatus(i)]++;
    if (isImpedimentOverdue(i, today)) counts.overdue++;
  }
  return counts;
}

/** Unresolved ones per category, most first; "No category" for the rest. */
export function openByCategory(list: readonly Impediment[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of list) {
    if (impedimentStatus(i) === "resolved") continue;
    const label = categoryLabel(i.category);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts, ([label, count]) => ({ label, count })).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label)
  );
}

/* ── Resolution times ─────────────────────────────────────────────────── */

/** Days from raised to resolved, for each resolved one with readable dates. */
export function resolutionDays(list: readonly Impediment[]): number[] {
  const out: number[] = [];
  for (const i of list) {
    const resolved = dayOf(i.resolvedAt);
    if (!resolved) continue;
    const age = impedimentAgeDays(i, resolved);
    if (age !== null) out.push(age);
  }
  return out;
}

/* ── Weekly series ────────────────────────────────────────────────────── */

/** At most this many weeks, ending with the current one. */
export const WEEK_CAP = 26;

export interface WeekPoint {
  /** The Monday the week starts on, "YYYY-MM-DD". */
  start: string;
  /** Raised that week. */
  raised: number;
  /** Still unresolved when the week ended. */
  open: number;
}

/** The Monday on or before `day` (teams plan in Monday-to-Friday weeks). */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/**
 * Impediments raised per week and still open at each week's end, from the
 * week of the first one raised to this week. Capped at the most recent
 * WEEK_CAP weeks: anchoring at the first week and stopping after 26 once
 * kept the oldest half-year instead, so a tracker older than that froze on
 * stale weeks while new impediments fell outside every bucket.
 */
export function buildWeeklyImpedimentSeries(
  list: readonly Impediment[],
  today: string
): WeekPoint[] {
  const now = dayOf(today);
  if (!now) return [];
  const rows = list.flatMap((i) => {
    const raised = dayOf(i.raisedAt);
    return raised ? [{ raised, resolved: dayOf(i.resolvedAt) }] : [];
  });
  if (rows.length === 0) return [];

  // A reduce, not Math.min(...), so a very long list can't overflow the stack.
  const earliest = rows.reduce((min, r) => (r.raised < min ? r.raised : min), now);
  const last = weekStart(now);
  const weeks = Math.min(WEEK_CAP, Math.floor(daysBetween(weekStart(earliest), last) / 7) + 1);
  const first = addDays(last, -(weeks - 1) * 7);

  const points: WeekPoint[] = [];
  for (let w = 0; w < weeks; w++) {
    const start = addDays(first, w * 7);
    const end = addDays(start, 7);
    let raised = 0;
    let open = 0;
    for (const r of rows) {
      if (r.raised >= start && r.raised < end) raised++;
      if (r.raised < end && (!r.resolved || r.resolved >= end)) open++;
    }
    points.push({ start, raised, open });
  }
  return points;
}

/** The weekly chart's one-sentence summary and its rows as a table. */
export function weeklyChartText(points: readonly WeekPoint[]): ChartText {
  const table = {
    columns: ["Week of", "Raised", "Open at week end"],
    rows: points.map((p) => [dayLabel(p.start, true), p.raised, p.open]),
  };
  if (points.length === 0) return { summary: "No impediments raised yet.", table };
  const total = points.reduce((sum, p) => sum + p.raised, 0);
  const current = points[points.length - 1];
  const busiest = points.reduce((best, p) => (p.raised > best.raised ? p : best), points[0]);
  const span =
    points.length === 1
      ? `${total} raised this week`
      : `${total} raised over the last ${points.length} weeks, ${current.raised} this week`;
  // Named only when it stands out from this week.
  const peak =
    busiest.raised > current.raised
      ? `; the most in one week was ${busiest.raised}, the week of ${dayLabel(busiest.start)}`
      : "";
  return {
    summary: `${span}${peak}. ${current.open} ${current.open === 1 ? "is" : "are"} still open.`,
    table,
  };
}

/** "4.5 days" for an average; "—" when there is none. */
export const avgDaysText = (n: number | null) =>
  n === null ? NO_VALUE : `${fmt(n)} ${n === 1 ? "day" : "days"}`;
