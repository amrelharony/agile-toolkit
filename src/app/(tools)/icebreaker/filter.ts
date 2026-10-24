import type { IceBreaker } from "@/lib/constants/icebreakers";
import { todayLocalISO } from "@/lib/utils/formatters";
import { fitsPeople } from "./sizes";
import type { IcebreakerSettings, IcebreakerUse } from "./store";

/**
 * Which activities to offer. Pure: the page passes the catalog, the
 * filters and the saved settings.
 *
 * "Used recently" is what stops last week's warm-up coming back: Random
 * Pick used to exclude only the pick just shown. A use is recorded when the
 * timer starts or the facilitator marks it used, with a date.
 */

/** How far back "used recently" looks. */
export const RECENT_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type Energy = IceBreaker["energyLevel"];
export type Category = IceBreaker["category"];

export interface IcebreakerFilters {
  /** Headcount; null for any size. */
  people: number | null;
  /** "Up to N minutes"; null for any length. */
  maxMinutes: number | null;
  energy: Energy | null;
  category: Category | null;
  favoritesOnly: boolean;
  hideRecent: boolean;
}

export const NO_FILTERS: IcebreakerFilters = {
  people: null,
  maxMinutes: null,
  energy: null,
  category: null,
  favoritesOnly: false,
  hideRecent: false,
};

/** The newest use of `id`, ISO, or null when it was never used. */
export function lastUsedAt(used: readonly IcebreakerUse[], id: string): string | null {
  let best: string | null = null;
  for (const u of used) {
    if (u.icebreakerId !== id) continue;
    if (best === null || Date.parse(u.usedAt) > Date.parse(best)) best = u.usedAt;
  }
  return best;
}

/** Whole days between a use and now, by calendar day (today is 0). */
export function daysAgo(usedAt: string, now: Date): number {
  const a = new Date(usedAt);
  const from = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const to = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((to - from) / DAY_MS);
}

/** "today", "yesterday", "3 days ago". */
export function daysAgoText(usedAt: string, now: Date): string {
  const d = daysAgo(usedAt, now);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

/**
 * Catalog ids used in the last RECENT_DAYS calendar days, today included:
 * a warm-up run on a Monday is recent until the Monday two weeks later.
 */
export function recentIds(used: readonly IcebreakerUse[], now: Date): Set<string> {
  const out = new Set<string>();
  for (const u of used) {
    const d = daysAgo(u.usedAt, now);
    if (d >= 0 && d < RECENT_DAYS) out.add(u.icebreakerId);
  }
  return out;
}

/** The filters every activity is held to, before favourites and "recent". */
function fitsBasics(ib: IceBreaker, f: IcebreakerFilters): boolean {
  // "Up to N min": an activity fits if it takes N minutes or less, so
  // picking 10 min still offers the 2- and 5-minute ones.
  if (f.maxMinutes !== null && ib.timeMinutes > f.maxMinutes) return false;
  if (!fitsPeople(ib, f.people)) return false;
  if (f.energy !== null && ib.energyLevel !== f.energy) return false;
  if (f.category !== null && ib.category !== f.category) return false;
  return true;
}

export interface FilterResult {
  matches: IceBreaker[];
  /** Matches left out because they were used recently (hideRecent). */
  hiddenRecent: IceBreaker[];
}

export function filterIcebreakers(
  list: readonly IceBreaker[],
  f: IcebreakerFilters,
  s: Pick<IcebreakerSettings, "favorites" | "used">,
  now: Date
): FilterResult {
  const favorites = new Set(s.favorites);
  const recent = recentIds(s.used, now);
  const matches: IceBreaker[] = [];
  const hiddenRecent: IceBreaker[] = [];
  for (const ib of list) {
    if (!fitsBasics(ib, f)) continue;
    if (f.favoritesOnly && !favorites.has(ib.id)) continue;
    if (f.hideRecent && recent.has(ib.id)) hiddenRecent.push(ib);
    else matches.push(ib);
  }
  return { matches, hiddenRecent };
}

export type RelaxableFilter = "people" | "maxMinutes" | "energy" | "category" | "favoritesOnly";

/**
 * The filter to relax when nothing matches: the one whose removal brings
 * back the most activities, with how many. Null when no single filter does.
 */
export function relaxHint(
  list: readonly IceBreaker[],
  f: IcebreakerFilters,
  s: Pick<IcebreakerSettings, "favorites" | "used">,
  now: Date
): { filter: RelaxableFilter; count: number } | null {
  const cleared: Record<RelaxableFilter, Partial<IcebreakerFilters>> = {
    people: { people: null },
    maxMinutes: { maxMinutes: null },
    energy: { energy: null },
    category: { category: null },
    favoritesOnly: { favoritesOnly: false },
  };
  let best: { filter: RelaxableFilter; count: number } | null = null;
  for (const key of Object.keys(cleared) as RelaxableFilter[]) {
    const active = key === "favoritesOnly" ? f.favoritesOnly : f[key] !== null;
    if (!active) continue;
    const count = filterIcebreakers(list, { ...f, ...cleared[key] }, s, now).matches.length;
    if (count > 0 && (best === null || count > best.count)) best = { filter: key, count };
  }
  return best;
}

/**
 * A random activity from `candidates`, never the one just shown when there
 * is another, so a second Pick always moves on.
 */
export function pickRandom<T extends { id: string }>(
  candidates: readonly T[],
  prevId: string | null | undefined,
  rand: () => number = Math.random
): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const pool = prevId ? candidates.filter((c) => c.id !== prevId) : candidates;
  const from = pool.length > 0 ? pool : candidates;
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))];
}

/**
 * The uses with one more for `icebreakerId` on `usedAt`'s day, or the same
 * list when it was already recorded that day: restarting a warm-up's timer
 * in the same meeting is still one use.
 */
export function withUse(
  used: readonly IcebreakerUse[],
  use: IcebreakerUse
): { next: IcebreakerUse[]; added: boolean } {
  const day = todayLocalISO(new Date(use.usedAt));
  const same = used.some(
    (u) => u.icebreakerId === use.icebreakerId && todayLocalISO(new Date(u.usedAt)) === day
  );
  return same ? { next: [...used], added: false } : { next: [use, ...used], added: true };
}
