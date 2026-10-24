import type { IceBreaker } from "@/lib/constants/icebreakers";

/**
 * Team size as a headcount. The page used to filter on three buckets
 * ("2-5", "5-10", "10+") matched exactly, so a team of 5 or 10 sat in two
 * and the roster was never read. Now each activity has a people range, the
 * bucket's unless the catalog gives its own (`minPeople` / `maxPeople`),
 * and the filter asks "does it work for 7 people?". The ranges overlap at
 * the edges on purpose: a team of five fits both small and medium ones.
 */

export interface PeopleRange {
  min: number;
  /** Null for no upper limit. */
  max: number | null;
}

export const SIZE_RANGE: Record<IceBreaker["teamSize"], PeopleRange> = {
  small: { min: 2, max: 5 },
  medium: { min: 5, max: 10 },
  large: { min: 10, max: null },
};

/** The fewest and most people it works with. */
export function peopleRange(ib: IceBreaker): PeopleRange {
  const base = SIZE_RANGE[ib.teamSize];
  return {
    min: ib.minPeople ?? base.min,
    max: ib.maxPeople !== undefined ? ib.maxPeople : base.max,
  };
}

/** Whether it works for `people`; null (any size) fits everything. */
export function fitsPeople(ib: IceBreaker, people: number | null): boolean {
  if (people === null) return true;
  const { min, max } = peopleRange(ib);
  return people >= min && (max === null || people <= max);
}

/** "2–5 people", "10+ people". */
export function peopleLabel(ib: IceBreaker): string {
  const { min, max } = peopleRange(ib);
  return max === null ? `${min}+ people` : `${min}–${max} people`;
}

export const MIN_HEADCOUNT = 2;
export const MAX_HEADCOUNT = 200;

/**
 * The People field: blank is "any size", anything else must be a whole
 * number of people an icebreaker can be run with.
 */
export function validateHeadcount(text: string): { value: number | null; error?: string } {
  const raw = text.trim();
  if (raw === "") return { value: null };
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    return { value: null, error: "Enter a whole number of people, or leave it blank." };
  }
  if (n < MIN_HEADCOUNT) return { value: null, error: "An icebreaker needs at least 2 people." };
  if (n > MAX_HEADCOUNT) {
    return { value: null, error: `Enter ${MAX_HEADCOUNT} people or fewer.` };
  }
  return { value: n };
}

/**
 * The headcount the filter starts from: the team roster's size once the
 * workspace has loaded, or null (any size) for an empty roster or a team
 * of one, which no icebreaker is for.
 */
export function rosterHeadcount(rosterSize: number, hydrated: boolean): number | null {
  if (!hydrated) return null;
  return rosterSize >= MIN_HEADCOUNT ? Math.min(rosterSize, MAX_HEADCOUNT) : null;
}
