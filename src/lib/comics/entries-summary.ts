/**
 * The portal's view of the anonymous counts, month by month and nothing finer:
 * visits by printed piece, and for each book episode, posters against kudos
 * cards. Pure.
 */

import { PRINT_SOURCES, isBookEp, type ArrivalSource } from "./entry";

/** A row of comic_visit_counts (migration 0034). */
export interface VisitCountRow {
  month: string;
  path: string;
  src: string;
  ep: number;
  count: number | string;
}

/**
 * A row of comic_entry_counts (0029, 0032), read by day. The book's VIP link
 * still counts there; its poster and direct rows are the counts from before
 * 0034, which the report folds in, so the month the counter changed is whole.
 */
export interface EntryCountRow {
  day: string;
  entry: string;
  ep: number;
  count: number | string;
}

/** Every source, in the order the report lists them. */
export const REPORT_SOURCES: readonly ArrivalSource[] = [...PRINT_SOURCES, "none"];

export interface MonthSummary {
  /** The month's first day, YYYY-MM-01. */
  month: string;
  total: number;
  bySource: Record<ArrivalSource, number>;
  /** Devices unlocked by the link printed inside the book. */
  vip: number;
  /** Book episodes scanned from a poster or a kudos card, by number. */
  byEpisode: { ep: number; poster: number; kudos: number }[];
}

/** bigint comes back from the API as a number or a string, depending on size. */
function countOf(row: { count: number | string }): number {
  const count = Number(row.count);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function emptyMonth(month: string): MonthSummary {
  const bySource = Object.fromEntries(REPORT_SOURCES.map((s) => [s, 0])) as Record<
    ArrivalSource,
    number
  >;
  return { month, total: 0, bySource, vip: 0, byEpisode: [] };
}

/** Newest month first. */
export function summariseVisits(
  visits: readonly VisitCountRow[],
  entries: readonly EntryCountRow[]
): MonthSummary[] {
  const months = new Map<string, MonthSummary>();
  const episodes = new Map<string, Map<number, { poster: number; kudos: number }>>();
  const monthOf = (date: string) => {
    const key = date.slice(0, 7) + "-01";
    let summary = months.get(key);
    if (!summary) {
      summary = emptyMonth(key);
      months.set(key, summary);
    }
    return summary;
  };
  const add = (summary: MonthSummary, src: ArrivalSource, ep: number, count: number) => {
    summary.bySource[src] += count;
    summary.total += count;
    if ((src === "poster" || src === "kudos") && isBookEp(ep)) {
      const byEp = episodes.get(summary.month) ?? new Map();
      episodes.set(summary.month, byEp);
      const tally = byEp.get(ep) ?? { poster: 0, kudos: 0 };
      tally[src] += count;
      byEp.set(ep, tally);
    }
  };

  for (const row of visits) {
    const count = countOf(row);
    if (!count || !(REPORT_SOURCES as readonly string[]).includes(row.src)) continue;
    // An episode only says which poster or kudos card when it was scanned to /comics.
    const ep = row.path === "/comics" ? row.ep : 0;
    add(monthOf(row.month), row.src as ArrivalSource, ep, count);
  }
  for (const row of entries) {
    const count = countOf(row);
    if (!count) continue;
    if (row.entry === "vip") {
      const summary = monthOf(row.day);
      summary.vip += count;
      summary.total += count;
    } else if (row.entry === "poster") {
      add(monthOf(row.day), "poster", row.ep, count);
    } else if (row.entry === "direct") {
      add(monthOf(row.day), "none", 0, count);
    }
  }
  for (const [month, byEp] of Array.from(episodes)) {
    monthOf(month).byEpisode = Array.from(byEp, ([ep, t]) => ({ ep, ...t })).sort(
      (a, b) => a.ep - b.ep
    );
  }
  return Array.from(months.values()).sort((a, b) => b.month.localeCompare(a.month));
}
