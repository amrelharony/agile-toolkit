/**
 * Anonymous engagement counts for the weekly stories: what a page may send to
 * /api/comics/stats, the reading-time bands, and the thresholds the pages use.
 * Pure, for the route, the browser and the owner's Insights alike.
 *
 * Nothing here identifies a reader. A browser's own record (lib/comics/reading)
 * decides whether something is its first view, first finish or love, and the
 * server keeps only weekly totals per story (migration 0036).
 */

/** Everything except reading time, which comes as "time:<band>". */
export const STAT_METRICS = [
  "view",
  "visitor",
  "reader",
  "love",
  "unlove",
  "share",
  "retro",
  "tool",
] as const;
export type StatMetric = (typeof STAT_METRICS)[number];

/**
 * Upper ends, in seconds, of the active-time bands: under 10 s, 10–30 s,
 * 30 s–1 min, 1–2 min, 2–5 min, then 5 min or more.
 */
export const TIME_BANDS = [10, 30, 60, 120, 300] as const;
export const TIME_BAND_LABELS = [
  "Under 10 s",
  "10–30 s",
  "30 s–1 min",
  "1–2 min",
  "2–5 min",
  "5 min or more",
] as const;
export const TIME_BAND_COUNT = TIME_BAND_LABELS.length;

export type StatEvent = StatMetric | `time:${number}`;

/** The most events one request may carry. */
export const MAX_STAT_EVENTS = 6;

/**
 * How many of each event one connection (its address, only ever a salted hash
 * in memory: api/comics/_guard) may add to one story in an hour. A browser
 * sends each first only once; these slow a loop down. They can't stop a
 * patient one: each window is an hour from its first event, and each server
 * instance keeps its own.
 *
 * A balance, tunable here. An office or a phone network behind one address
 * shares these, so opens and finishes allow a crowd. Loves sit below
 * FAVOURITES_MIN_LOVES, so a connection reaching one instance needs more than
 * an hour to put a story in Readers' favourites on its own, or to take back
 * more than a few loves; the price is that a team behind one address counts at most 3 hearts
 * (and 3 take-backs) a story an hour. A love over the limit simply isn't
 * counted: that reader's heart stays theirs, and the heart says it wasn't
 * counted. Views and time bands fall under the route's overall limit.
 */
export const EVENT_LIMITS_PER_HOUR: Readonly<Partial<Record<StatMetric, number>>> = {
  visitor: 30,
  reader: 30,
  love: 3,
  unlove: 3,
  share: 10,
  retro: 10,
  tool: 20,
};

/** A visible tab with no scroll, pointer, key or touch for this long stops the clock. */
export const IDLE_AFTER_S = 60;
/** One view never adds more than this much reading time. */
export const ACTIVE_CAP_S = 600;

/** "Read by N readers" shows from this many. */
export const SHOW_READERS_AT = 10;
/** A story joins Readers' favourites from this many loves. */
export const FAVOURITES_MIN_LOVES = 5;
export const FAVOURITES_COUNT = 5;

/** Which band `seconds` of active reading falls in. */
export function timeBand(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  const at = TIME_BANDS.findIndex((upper) => seconds < upper);
  return at === -1 ? TIME_BANDS.length : at;
}

export const timeEvent = (seconds: number): StatEvent => `time:${timeBand(seconds)}`;

function isEvent(value: unknown): value is StatEvent {
  if (typeof value !== "string") return false;
  if ((STAT_METRICS as readonly string[]).includes(value)) return true;
  const band = /^time:(\d)$/.exec(value);
  return band !== null && Number(band[1]) < TIME_BAND_COUNT;
}

export interface StatsBody {
  ep: number;
  events: StatEvent[];
}

/**
 * What the public route accepts, before it checks the story itself: a weekly
 * story's number and 1 to MAX_STAT_EVENTS known events, none twice, at most one
 * reading time, and never a love and its taking back together.
 */
export function parseStats(raw: unknown): StatsBody | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { ep, events } = raw as Record<string, unknown>;
  if (typeof ep !== "number" || !Number.isInteger(ep) || ep < 27 || ep > 999) return null;
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_STAT_EVENTS) {
    return null;
  }
  if (!events.every(isEvent) || new Set(events).size !== events.length) return null;
  if (events.filter((e) => e.startsWith("time:")).length > 1) return null;
  if (events.includes("love") && events.includes("unlove")) return null;
  return { ep, events: events as StatEvent[] };
}

/** One story's totals, as the pages read them (comic_story_totals). */
export interface StoryTotals {
  views: number;
  visitors: number;
  readers: number;
  loves: number;
  shares: number;
  retros: number;
  tools: number;
}

export const NO_TOTALS: StoryTotals = {
  views: 0,
  visitors: 0,
  readers: 0,
  loves: 0,
  shares: 0,
  retros: 0,
  tools: 0,
};

const count = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** A comic_story_totals row (bigints may arrive as strings) as numbers. */
export function readTotals(row: Record<string, unknown> | null | undefined): StoryTotals {
  if (!row) return NO_TOTALS;
  return {
    views: count(row.views),
    visitors: count(row.visitors),
    readers: count(row.readers),
    loves: count(row.loves),
    shares: count(row.shares),
    retros: count(row.retros),
    tools: count(row.tools),
  };
}

/** The answer to a stats write: the story's net loves and readers. */
export interface StatsAnswer {
  loves: number;
  readers: number;
}

export function readStatsAnswer(raw: unknown): StatsAnswer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { loves, readers } = raw as Record<string, unknown>;
  if (typeof loves !== "number" || typeof readers !== "number") return null;
  return { loves: count(loves), readers: count(readers) };
}

/**
 * The top stories by loves, for Readers' favourites: at least
 * FAVOURITES_MIN_LOVES each, most loved first, then the newer number.
 */
export function pickFavourites<T extends { ep: number }>(
  stories: readonly T[],
  loves: ReadonlyMap<number, number>,
  limit = FAVOURITES_COUNT
): (T & { loves: number })[] {
  return stories
    .map((s) => ({ ...s, loves: loves.get(s.ep) ?? 0 }))
    .filter((s) => s.loves >= FAVOURITES_MIN_LOVES)
    .sort((a, b) => b.loves - a.loves || b.ep - a.ep)
    .slice(0, limit);
}
