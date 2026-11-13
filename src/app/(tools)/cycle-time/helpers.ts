/**
 * Cycle Time Analyzer — the finished items from every source and the
 * numbers read off them. Pure, so the page, its export, the tests and
 * tool.cycle_time.* (which runs the same lib/flow pipeline on the server)
 * agree to the day.
 *
 * One day convention for every source (lib/flow cycleDays): whole local
 * calendar days with the start and the finish both counted, so an item
 * started and finished on the same day took 1 day, not 0. Percentiles are
 * the shared nearest-rank `percentile` (lib/sprints/metrics, through
 * lib/flow cycleSummary), so the page, the Flow board and the agent quote
 * one P85.
 */

import {
  ageingWip,
  cardItems,
  cycleDays,
  cycleSummary,
  finishedItems,
  stageBreakdown,
  storyItems,
  weekOf,
  type AgeingItem,
  type CycleSummary,
  type StageBreakdown,
} from "@/lib/flow";
import { enoughData } from "@/lib/analytics/min-sample";
import { percentile } from "@/lib/sprints/metrics";
import { isoDayNumber } from "@/lib/sprints/calendar";
import type { KanbanCard, Story } from "@/lib/stores/workspace-types";
import type { CycleRow, CycleSource, HistogramDatum, ScatterDatum, WorkItem } from "./types";

export const SOURCE_LABEL: Record<CycleSource, string> = {
  story: "Sprint board",
  card: "Flow board",
  typed: "Typed",
};

/** The finished stories and Flow-board cards with a start and a finish, as cycle-time rows. */
export function boardRows(
  stories: readonly Story[],
  cards: readonly KanbanCard[],
  opts: { includeExamples?: boolean } = {}
): CycleRow[] {
  const items = [...storyItems(stories, opts), ...cardItems(cards, opts)];
  return finishedItems(items).map((f) => ({
    id: f.id,
    title: f.title,
    source: f.kind === "story" ? "story" : f.kind === "card" ? "card" : "typed",
    startedOn: f.startedOn,
    doneOn: f.doneOn,
    days: f.days,
  }));
}

/** A typed item's cycle time, counted like the boards'; null while a date is missing or backwards. */
export function typedDays(item: Pick<WorkItem, "startDate" | "endDate">): number | null {
  return cycleDays(item.startDate, item.endDate);
}

/** The typed items that have both dates the right way round. */
export function typedRows(items: readonly WorkItem[]): CycleRow[] {
  const out: CycleRow[] = [];
  for (const i of items) {
    const days = typedDays(i);
    if (days === null) continue;
    out.push({
      id: i.id,
      title: i.name.trim() || "Untitled",
      source: "typed",
      startedOn: i.startDate,
      doneOn: i.endDate,
      days,
    });
  }
  return out;
}

/** Every row from the sources picked, in order of completion (oldest finish first). */
export function rowsFrom(rows: readonly CycleRow[], sources: ReadonlySet<CycleSource>): CycleRow[] {
  return rows
    .filter((r) => sources.has(r.source))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.doneOn < b.r.doneOn ? -1 : a.r.doneOn > b.r.doneOn ? 1 : a.i - b.i))
    .map(({ r }) => r);
}

/** The percentiles in the SLE table. */
export const PERCENTILE_KEYS = [50, 75, 85, 90, 95] as const;

export interface CycleStats {
  summary: CycleSummary;
  /** Whether the average may be quoted (MIN_SAMPLE.average). */
  averageQuoted: boolean;
  /** Whether the median, percentiles, spread and histogram may be quoted (MIN_SAMPLE.distribution). */
  distributionQuoted: boolean;
  percentiles: Record<(typeof PERCENTILE_KEYS)[number], number | null>;
}

export function cycleStats(rows: readonly CycleRow[]): CycleStats {
  const days = rows.map((r) => r.days);
  const summary = cycleSummary(days);
  const distributionQuoted = enoughData(summary.count, "distribution");
  return {
    summary,
    averageQuoted: enoughData(summary.count, "average"),
    distributionQuoted,
    percentiles: Object.fromEntries(
      PERCENTILE_KEYS.map((p) => [p, distributionQuoted ? percentile(days, p) : null])
    ) as CycleStats["percentiles"],
  };
}

/** The SLE at a percentile: "P% of items finish within N days"; null below the sample floor. */
export function sleDays(rows: readonly CycleRow[], pct: number): number | null {
  return enoughData(rows.length, "distribution")
    ? percentile(
        rows.map((r) => r.days),
        pct
      )
    : null;
}

/** How many finished items made it within `target` days. */
export function withinTarget(
  rows: readonly CycleRow[],
  target: number
): { within: number; total: number; pct: number | null } {
  const within = rows.filter((r) => r.days <= target).length;
  return { within, total: rows.length, pct: rows.length ? (within / rows.length) * 100 : null };
}

/** Day buckets for the histogram; a same-day item (1 day) is the first. */
export const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "1 day", min: 1, max: 1 },
  { label: "2 days", min: 2, max: 2 },
  { label: "3-4 days", min: 3, max: 4 },
  { label: "5-7 days", min: 5, max: 7 },
  { label: "8-14 days", min: 8, max: 14 },
  { label: "15+ days", min: 15, max: Infinity },
];

export function histogram(rows: readonly CycleRow[]): HistogramDatum[] {
  return BUCKETS.map((b) => ({
    bucket: b.label,
    count: rows.filter((r) => r.days >= b.min && r.days <= b.max).length,
  }));
}

/** One point per finished item at its finish day, in order of completion. */
export function scatterPoints(rows: readonly CycleRow[]): ScatterDatum[] {
  return rows.map((r) => ({
    x: isoDayNumber(r.doneOn) as number,
    doneOn: r.doneOn,
    cycleTime: r.days,
    name: r.title,
    source: r.source,
  }));
}

/**
 * The mean cycle time per ISO week of completion, for the trend test, in
 * week order. Weeks with nothing finished have no mean and are skipped.
 */
export function weeklyMeans(rows: readonly CycleRow[]): { week: string; mean: number }[] {
  const byWeek = new Map<string, number[]>();
  for (const r of rows) {
    const week = weekOf(r.doneOn);
    if (!week) continue;
    byWeek.set(week, [...(byWeek.get(week) ?? []), r.days]);
  }
  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, xs]) => ({ week, mean: xs.reduce((a, b) => a + b, 0) / xs.length }));
}

/**
 * The work in progress on both boards, oldest first, aged like a cycle
 * time (the start day is 1) and flagged against the P85 once that may be
 * quoted (MIN_SAMPLE.distribution finished items).
 */
export function ageingRows(
  stories: readonly Story[],
  cards: readonly KanbanCard[],
  today: string,
  p85: number | null,
  opts: { includeExamples?: boolean } = {}
): AgeingItem[] {
  return ageingWip([...storyItems(stories, opts), ...cardItems(cards, opts)], today, p85);
}

/**
 * Time in each status for the finished stories and cards of the sources
 * picked (typed items have no statuses), read with these waiting statuses:
 * lib/flow stageBreakdown, as tool.cycle_time.by_stage reads it.
 */
export function boardStages(
  stories: readonly Story[],
  cards: readonly KanbanCard[],
  sources: ReadonlySet<CycleSource>,
  waiting: readonly string[],
  opts: { includeExamples?: boolean } = {}
): StageBreakdown {
  const items = [
    ...(sources.has("story") ? storyItems(stories, opts) : []),
    ...(sources.has("card") ? cardItems(cards, opts) : []),
  ];
  return stageBreakdown(items, { waiting });
}

export function round(v: number, d = 1) {
  return Math.round(v * 10 ** d) / 10 ** d;
}
