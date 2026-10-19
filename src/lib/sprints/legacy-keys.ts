/**
 * Storage keys of the old per-tool sprint data, from before the sprint
 * tools shared one list of sprints. Only the one-time migration
 * (`migrate-legacy.ts`) reads them; new tool code must never reuse these
 * names. Kept in this tiny module so the migration's mount point can check
 * for them without loading the migration itself.
 */

export const LEGACY_SPRINT_KEYS = {
  burndown: "agile-toolkit:burndown",
  burnup: "agile-toolkit:burnup",
  velocity: "agile-toolkit:velocity",
  compare: "agile-toolkit:sprint-compare",
} as const;

export type LegacySprintSource = keyof typeof LEGACY_SPRINT_KEYS;

/** Processing order: Velocity rows first, so the others can match them. */
export const LEGACY_SPRINT_SOURCES: readonly LegacySprintSource[] = [
  "velocity",
  "burndown",
  "burnup",
  "compare",
];

/**
 * Sprint Comparison's pinned sprints: a JSON array of sprint ids (at most 5).
 * The migration seeds it from the old comparison rows when it is absent.
 */
export const SPRINT_COMPARE_PINS_KEY = "agile-toolkit:sprint-compare:pins";

/** Cheap synchronous check: is any old sprint key still in this browser? */
export function hasLegacySprintData(storage?: Pick<Storage, "getItem"> | null): boolean {
  let store: Pick<Storage, "getItem"> | null | undefined = storage;
  try {
    if (store === undefined) store = typeof window === "undefined" ? null : window.localStorage;
    if (!store) return false;
    const s = store;
    return LEGACY_SPRINT_SOURCES.some((source) => s.getItem(LEGACY_SPRINT_KEYS[source]) !== null);
  } catch {
    // Storage blocked (private mode, site data off): nothing we can move.
    return false;
  }
}
