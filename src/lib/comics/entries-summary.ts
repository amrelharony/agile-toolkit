/**
 * The portal's view of the anonymous counts, month by month and nothing finer:
 * visits by printed piece, and for each book episode, posters against kudos
 * cards. Pure.
 */

import type { ArrivalSource } from "./entry";

/** A row of comic_visit_counts (migration 0034). */
export interface VisitCountRow {
  month: string;
  path: string;
  src: string;
  ep: number;
  count: number | string;
}

/** A VIP row of comic_entry_counts (0029, 0032): the book's VIP link still counts there by day. */
export interface VipCountRow {
  day: string;
  count: number | string;
}

/** Every source, in the order the report lists them. */
export const REPORT_SOURCES: readonly ArrivalSource[] = [
  "poster",
  "kudos",
  "book",
  "sign",
  "guide",
  "comics",
  "none",
];

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
  return Number.isFinite(count) ? count : 0;
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
  vip: readonly VipCountRow[]
): MonthSummary[] {
  const months = new Map<string, MonthSummary>();
  const monthOf = (key: string) => {
    let summary = months.get(key);
    if (!summary) {
      summary = emptyMonth(key);
      months.set(key, summary);
    }
    return summary;
  };
  const episodes = new Map<string, Map<number, { poster: number; kudos: number }>>();

  for (const row of visits) {
    const count = countOf(row);
    if (!count || !(REPORT_SOURCES as readonly string[]).includes(row.src)) continue;
    const month = row.month.slice(0, 7) + "-01";
    const summary = monthOf(month);
    const src = row.src as ArrivalSource;
    summary.bySource[src] += count;
    summary.total += count;
    if ((src === "poster" || src === "kudos") && row.ep > 0 && row.path === "/comics") {
      const byEp = episodes.get(month) ?? new Map();
      episodes.set(month, byEp);
      const tally = byEp.get(row.ep) ?? { poster: 0, kudos: 0 };
      tally[src] += count;
      byEp.set(row.ep, tally);
    }
  }
  for (const row of vip) {
    const count = countOf(row);
    if (!count) continue;
    const summary = monthOf(row.day.slice(0, 7) + "-01");
    summary.vip += count;
    summary.total += count;
  }
  for (const [month, byEp] of Array.from(episodes)) {
    monthOf(month).byEpisode = Array.from(byEp, ([ep, t]) => ({ ep, ...t })).sort(
      (a, b) => a.ep - b.ep
    );
  }
  return Array.from(months.values()).sort((a, b) => b.month.localeCompare(a.month));
}
