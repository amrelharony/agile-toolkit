import {
  LS_CATALOG,
  LS_PURPOSES,
  fitsGroup,
  isLsStructureId,
  type LsPurpose,
  type LsStructure,
} from "@/lib/liberating-structures/catalog";
import { CEREMONY_KINDS, type CeremonyKind } from "@/lib/sprints/cadence";

/**
 * Choosing a structure: by the number of people, what the group should
 * leave with, the Scrum event it's for and how long there is. Pure: the
 * page holds the filters, these pieces apply them.
 */

export type TimingBucket = "under 15 min" | "15-30 min" | "30+ min";

export const TIMING_BUCKETS: readonly TimingBucket[] = ["under 15 min", "15-30 min", "30+ min"];

export const TIMING_LABEL: Record<TimingBucket, string> = {
  "under 15 min": "Under 15 min",
  "15-30 min": "15–30 min",
  "30+ min": "30+ min",
};

export function bucketFor(minutes: number): TimingBucket {
  if (minutes < 15) return "under 15 min";
  if (minutes <= 30) return "15-30 min";
  return "30+ min";
}

export interface LsFilters {
  /** Headcount; null for any size. */
  people: number | null;
  purpose: LsPurpose | null;
  ceremony: CeremonyKind | null;
  timing: TimingBucket | null;
}

export const NO_FILTERS: LsFilters = { people: null, purpose: null, ceremony: null, timing: null };

export function matchesFilters(s: LsStructure, f: LsFilters): boolean {
  if (!fitsGroup(s, f.people)) return false;
  if (f.purpose !== null && !s.purposes.includes(f.purpose)) return false;
  if (f.ceremony !== null && !s.ceremonies.includes(f.ceremony)) return false;
  if (f.timing !== null && bucketFor(s.timingMinutes) !== f.timing) return false;
  return true;
}

export function filterStructures(list: readonly LsStructure[], f: LsFilters): LsStructure[] {
  return list.filter((s) => matchesFilters(s, f));
}

export const isFiltered = (f: LsFilters) =>
  f.people !== null || f.purpose !== null || f.ceremony !== null || f.timing !== null;

/** The purposes some structure serves, in the order the chips show them. */
export const LS_FILTER_PURPOSES: readonly LsPurpose[] = LS_PURPOSES.filter((p) =>
  LS_CATALOG.some((s) => s.purposes.includes(p))
);

/**
 * The Scrum events some structure suits, in cadence order: no structure is
 * for the Daily Scrum, and a chip that always shows nothing is a dead end.
 */
export const LS_FILTER_CEREMONIES: readonly CeremonyKind[] = CEREMONY_KINDS.filter((c) =>
  LS_CATALOG.some((s) => s.ceremonies.includes(c))
);

/** Short names for the ceremony chips. */
export const CEREMONY_CHIP: Record<CeremonyKind, string> = {
  planning: "Planning",
  daily: "Daily Scrum",
  refinement: "Refinement",
  review: "Review",
  retro: "Retro",
};

export const MIN_GROUP = 2;
export const MAX_GROUP = 10_000;

/** The People field: blank is "any size", else a whole number of people. */
export function validatePeople(text: string): { value: number | null; error?: string } {
  const raw = text.trim();
  if (raw === "") return { value: null };
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    return { value: null, error: "Enter a whole number of people, or leave it blank." };
  }
  if (n < MIN_GROUP) return { value: null, error: "A structure needs at least 2 people." };
  if (n > MAX_GROUP) return { value: null, error: "Enter 10,000 people or fewer." };
  return { value: n };
}

/**
 * `?structure=ls-troika` opens that card and `?ceremony=retro` picks the
 * ceremony, for links from the retro, the guides and the agent. Anything
 * the catalog doesn't know is ignored.
 */
export function readDeepLink(search: string): {
  structureId: string | null;
  ceremony: CeremonyKind | null;
} {
  const params = new URLSearchParams(search);
  const structure = params.get("structure");
  const ceremony = params.get("ceremony");
  return {
    structureId: isLsStructureId(structure) ? structure : null,
    ceremony: LS_FILTER_CEREMONIES.find((c) => c === ceremony) ?? null,
  };
}

export type RelaxableLsFilter = keyof LsFilters;

/**
 * The filter to relax when nothing matches: the one whose removal brings
 * back the most structures, with how many. Null when no single filter does.
 */
export function relaxLsFilter(
  list: readonly LsStructure[],
  f: LsFilters
): { filter: RelaxableLsFilter; count: number } | null {
  let best: { filter: RelaxableLsFilter; count: number } | null = null;
  for (const key of Object.keys(NO_FILTERS) as RelaxableLsFilter[]) {
    if (f[key] === null) continue;
    const count = filterStructures(list, { ...f, [key]: null }).length;
    if (count > 0 && (best === null || count > best.count)) best = { filter: key, count };
  }
  return best;
}
