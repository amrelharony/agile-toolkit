import { isoDayNumber } from "@/lib/sprints/calendar";
import { toChoice, toDay, toNumber } from "@/lib/prioritization/methods/fields";
import {
  COD_URGENCIES,
  COD_URGENCY_LABEL,
  type CodUrgency,
} from "@/lib/prioritization/methods/cost-of-delay";
import type { RankedRow } from "@/lib/prioritization/rank";

/** A lane on the page: an urgency profile, "no profile yet", or "not scored". */
export type LaneId = CodUrgency | "none" | "unscored";

/** What each lane is ordered by, in the lane heading (the AI prompt quotes it too). */
export const LANE_HEADING: Record<LaneId, string> = {
  expedite: `${COD_URGENCY_LABEL.expedite}: do now`,
  fixed_date: `${COD_URGENCY_LABEL.fixed_date}: by latest start`,
  standard: `${COD_URGENCY_LABEL.standard}: by CD3`,
  none: "No urgency profile yet: by CD3",
  intangible: `${COD_URGENCY_LABEL.intangible}: by CD3`,
  unscored: "Not scored: add a duration",
};

/** The lanes in the registry's order (expedite, fixed date, standard, no profile, intangible), unscored last. */
export const LANE_ORDER: readonly LaneId[] = [
  "expedite",
  "fixed_date",
  "standard",
  "none",
  "intangible",
  "unscored",
];

/** A row's lane: unscored rows (no duration) wait in their own lane, whatever their profile. */
export function laneOf(r: RankedRow): LaneId {
  if (r.result.score === null) return "unscored";
  return toChoice(COD_URGENCIES, r.result.bucket) ?? "none";
}

/**
 * The rows by lane, each lane in the order it came in (the registry's:
 * fixed dates by latest start, the rest by CD3). Empty lanes are left out,
 * except the four profiles, which always show so the structure reads.
 */
export function codGroups(rows: readonly RankedRow[]) {
  return LANE_ORDER.map((id) => ({
    id,
    label: LANE_HEADING[id],
    rows: rows.filter((r) => laneOf(r) === id),
  })).filter((g) => g.rows.length > 0 || (COD_URGENCIES as readonly string[]).includes(g.id));
}

/** "3 Nov", with the year when it isn't this year's ("3 Jan 2027"). */
export function dayText(iso: string, today: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** A fixed-date row's schedule: the day it must land by, its latest start, and whether that start has passed. */
export interface FixedDateStart {
  fixedDate: string;
  latestStart: string;
  late: boolean;
  /** Days until the latest start (negative: past it). */
  daysLeft: number;
}

export function fixedDateStart(r: RankedRow, today: string): FixedDateStart | null {
  if (laneOf(r) !== "fixed_date") return null;
  const fixedDate = toDay(r.values.fixedDate);
  const latestStart =
    typeof r.result.extra?.latestStart === "string" ? r.result.extra.latestStart : null;
  if (!fixedDate || !latestStart) return null;
  const daysLeft = (isoDayNumber(latestStart) ?? 0) - (isoDayNumber(today) ?? 0);
  return { fixedDate, latestStart, late: daysLeft < 0, daysLeft };
}

/** "Start by 3 Nov to land by 1 Dec", or "Late: it had to start by 3 Nov to land by 1 Dec". */
export function startText(s: FixedDateStart, today: string): string {
  const start = dayText(s.latestStart, today);
  const land = dayText(s.fixedDate, today);
  return s.late
    ? `Late: it had to start by ${start} to land by ${land}`
    : `Start by ${start} to land by ${land}`;
}

/**
 * What waiting costs per week across the scored initiatives: the sum of
 * their cost of delay per week (one week of every one of them waiting).
 */
export function waitingPerWeek(rows: readonly RankedRow[]): { perWeek: number; count: number } {
  let perWeek = 0;
  let count = 0;
  for (const r of rows) {
    if (r.result.score === null) continue;
    const n = toNumber(r.values.perWeekUsd);
    if (n === undefined) continue;
    perWeek += Math.max(0, n);
    count += 1;
  }
  return { perWeek, count };
}
