/** The portal's view of the anonymous entry counts: totals, most first. Pure. */

export interface EntryCountRow {
  day: string;
  entry: string;
  ep: number;
  building: number;
  count: number | string;
}

export interface EntriesSummary {
  total: number;
  /** Plain /comics visits: the printed address or anyone typing it. */
  direct: number;
  poster: number;
  /** Devices unlocked by the link printed inside the book. */
  vip: number;
  byBuilding: { building: number; count: number }[];
  byEpisode: { ep: number; count: number }[];
  /** Newest first. */
  byDay: { day: string; count: number }[];
}

function add<K>(totals: Map<K, number>, key: K, count: number) {
  totals.set(key, (totals.get(key) ?? 0) + count);
}

export function summariseEntries(rows: readonly EntryCountRow[]): EntriesSummary {
  const buildings = new Map<number, number>();
  const episodes = new Map<number, number>();
  const days = new Map<string, number>();
  let direct = 0;
  let poster = 0;
  let vip = 0;
  for (const row of rows) {
    // bigint comes back from the API as a number or a string, depending on size.
    const count = Number(row.count);
    if (!Number.isFinite(count)) continue;
    add(days, row.day, count);
    if (row.entry === "direct") direct += count;
    if (row.entry === "vip") vip += count;
    if (row.entry === "poster") {
      poster += count;
      if (row.building > 0) add(buildings, row.building, count);
      if (row.ep > 0) add(episodes, row.ep, count);
    }
  }
  return {
    total: direct + poster + vip,
    direct,
    poster,
    vip,
    byBuilding: Array.from(buildings, ([building, count]) => ({ building, count })).sort(
      (a, b) => b.count - a.count || a.building - b.building
    ),
    byEpisode: Array.from(episodes, ([ep, count]) => ({ ep, count })).sort(
      (a, b) => b.count - a.count || a.ep - b.ep
    ),
    byDay: Array.from(days, ([day, count]) => ({ day, count })).sort((a, b) =>
      b.day.localeCompare(a.day)
    ),
  };
}
