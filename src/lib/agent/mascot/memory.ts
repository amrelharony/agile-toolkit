/**
 * What Amr remembers of a visitor between visits: that they've been before, how
 * long ago, how many days running, roughly how they like to play, and the last
 * few things he did (so he doesn't open with the same scene every time).
 *
 * It lives in this browser's localStorage under one key, stays under a few
 * kilobytes, and is never sent anywhere: it is about making him good company,
 * not about knowing the visitor. Clearing site data forgets it all.
 *
 * Pure apart from the storage and the clock, both passed in.
 */

export const MEMORY_KEY = "mascot_memory";
export const MEMORY_VERSION = 1;
/** How many of the last things he did are kept. */
export const RECENT_KEPT = 30;
/** How many different counters are kept (the most used survive). */
const COUNTS_KEPT = 24;
/** Refuse a stored value larger than this: it isn't ours. */
const MAX_BYTES = 8192;

export interface MascotMemory {
  v: typeof MEMORY_VERSION;
  /** The local day of the first visit, "YYYY-MM-DD". */
  firstDay: string;
  /** The local day of the latest visit. */
  lastDay: string;
  /** How many different days they've visited. */
  days: number;
  /** Days running, ending on lastDay. */
  streak: number;
  /** How often each thing has happened: pokes, pats, high fives, games. */
  counts: Record<string, number>;
  /** The last things he did, oldest first: reactions and scenes by name. */
  recent: string[];
}

/** How a visit begins, from what he remembers. */
export type Arrival =
  | { kind: "first" }
  | { kind: "same-day" }
  | { kind: "next-day"; streak: number }
  | { kind: "back"; daysAway: number };

type Store = Pick<Storage, "getItem" | "setItem">;

/** A date's local day as "YYYY-MM-DD". */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days from one local day to another. */
export function daysBetween(from: string, to: string): number {
  const at = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

export function emptyMemory(day: string): MascotMemory {
  return {
    v: MEMORY_VERSION,
    firstDay: day,
    lastDay: day,
    days: 0,
    streak: 0,
    counts: {},
    recent: [],
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What's stored, or null when there's nothing, or nothing we can read. */
export function loadMemory(storage: Store | null): MascotMemory | null {
  try {
    const raw = storage?.getItem(MEMORY_KEY);
    if (!raw || raw.length > MAX_BYTES) return null;
    const m = JSON.parse(raw) as Partial<MascotMemory> | null;
    if (!m || m.v !== MEMORY_VERSION) return null;
    if (typeof m.firstDay !== "string" || !DAY.test(m.firstDay)) return null;
    if (typeof m.lastDay !== "string" || !DAY.test(m.lastDay)) return null;
    const counts: Record<string, number> = {};
    for (const [k, n] of Object.entries(m.counts ?? {})) {
      if (typeof n === "number" && Number.isFinite(n) && n > 0)
        counts[k.slice(0, 40)] = Math.floor(n);
    }
    return {
      v: MEMORY_VERSION,
      firstDay: m.firstDay,
      lastDay: m.lastDay,
      days: Math.max(1, Math.floor(Number(m.days) || 1)),
      streak: Math.max(1, Math.floor(Number(m.streak) || 1)),
      counts,
      recent: Array.isArray(m.recent)
        ? m.recent.filter((s): s is string => typeof s === "string").slice(-RECENT_KEPT)
        : [],
    };
  } catch {
    return null;
  }
}

export function saveMemory(storage: Store | null, memory: MascotMemory): void {
  try {
    storage?.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    /* storage full or unavailable: he just won't remember */
  }
}

/**
 * Note a visit today: the memory as it is from now on, and how the visit begins.
 * A second visit on the same day changes nothing.
 */
export function noteVisit(
  memory: MascotMemory | null,
  now: Date
): { memory: MascotMemory; arrival: Arrival } {
  const today = localDay(now);
  if (!memory) {
    return { memory: { ...emptyMemory(today), days: 1, streak: 1 }, arrival: { kind: "first" } };
  }
  const away = daysBetween(memory.lastDay, today);
  if (away <= 0) return { memory, arrival: { kind: "same-day" } };
  const streak = away === 1 ? memory.streak + 1 : 1;
  const next = { ...memory, lastDay: today, days: memory.days + 1, streak };
  return {
    memory: next,
    arrival: away === 1 ? { kind: "next-day", streak } : { kind: "back", daysAway: away },
  };
}

/** The memory with one more of `what` counted (the least used counters fall off). */
export function counted(memory: MascotMemory, what: string): MascotMemory {
  const counts = { ...memory.counts, [what]: (memory.counts[what] ?? 0) + 1 };
  const keys = Object.keys(counts);
  if (keys.length > COUNTS_KEPT) {
    // The most used survive; among equals, the one just counted does.
    keys.sort((a, b) => counts[b] - counts[a] || (a === what ? -1 : b === what ? 1 : 0));
    for (const k of keys.slice(COUNTS_KEPT)) delete counts[k];
  }
  return { ...memory, counts };
}

/** The memory with `what` as the latest thing he did. */
export function recalled(memory: MascotMemory, what: string): MascotMemory {
  return { ...memory, recent: [...memory.recent, what].slice(-RECENT_KEPT) };
}
