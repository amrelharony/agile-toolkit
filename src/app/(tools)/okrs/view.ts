/**
 * What the OKR page shows around the objectives: the quarter filter and the
 * page's one-sentence verdict. Every number comes from lib/okrs (progress,
 * confidence bands, check-in age), the reading the agent's list_state and
 * Sprint Goal share; this file only counts and words them.
 */

import type { KeyResult, Okr } from "@/lib/stores/workspace-types";
import {
  CHECK_IN_STALE_DAYS,
  confidenceBand,
  daysSinceCheckIn,
  isConfidence,
  overallProgress,
} from "@/lib/okrs/progress";
import { currentQuarter, normalizeQuarter, quarterIndex } from "@/lib/roadmap/quarters";
import { plural } from "@/lib/charts/chart-text";

/** The filter value that shows every quarter. */
export const ALL_QUARTERS = "all";

/** The label for objectives saved with no quarter at all. */
export const NO_QUARTER = "No quarter";

/**
 * The group an objective's quarter falls in: the canonical "2026 Q4"
 * however it was written ("Q4 2026" from the old intent), text that isn't
 * a quarter as typed ("next spring", from before the picker), or "No
 * quarter".
 */
export function quarterKey(quarter: string | null | undefined): string {
  return normalizeQuarter(quarter) || (quarter ?? "").trim() || NO_QUARTER;
}

export interface QuarterChip {
  key: string;
  count: number;
  /** Today's quarter. */
  current: boolean;
}

/** One chip per quarter the objectives use: real quarters newest first, then the rest. */
export function quarterChips(okrs: readonly Okr[], now: Date = new Date()): QuarterChip[] {
  const counts = new Map<string, number>();
  for (const o of okrs) {
    const key = quarterKey(o.quarter);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const today = currentQuarter(now);
  return Array.from(counts, ([key, count]) => ({ key, count, current: key === today })).sort(
    (a, b) => {
      const ia = quarterIndex(a.key);
      const ib = quarterIndex(b.key);
      if (ia && ib) return ib - ia;
      if (ia || ib) return ia ? -1 : 1;
      return a.key.localeCompare(b.key);
    }
  );
}

/** The quarter the list opens on: today's when it has objectives, else every quarter. */
export function defaultQuarter(okrs: readonly Okr[], now: Date = new Date()): string {
  const today = currentQuarter(now);
  return okrs.some((o) => quarterKey(o.quarter) === today) ? today : ALL_QUARTERS;
}

export const inQuarter = (okr: Okr, filter: string) =>
  filter === ALL_QUARTERS || quarterKey(okr.quarter) === filter;

/** Whether a key result's last check-in is CHECK_IN_STALE_DAYS or more ago. */
export function isStale(kr: Pick<KeyResult, "checkIns">, today: string): boolean {
  const days = daysSinceCheckIn(kr, today);
  return days !== null && days >= CHECK_IN_STALE_DAYS;
}

/** The objectives that have a key result: the only ones progress can be read for. */
export const measuredObjectives = (okrs: readonly Okr[]) =>
  okrs.filter((o) => (o.keyResults ?? []).length > 0);

/**
 * Progress across the measured objectives (lib/okrs overallProgress, each
 * weighing the same), as a whole percentage; null when none has a key
 * result. An objective with none isn't 0% of the way, it isn't measured:
 * averaging it in as 0 pulled the figure down (the agent's list_state
 * measuredProgressPct and the health dashboard read it the same way).
 */
export function measuredProgressPct(okrs: readonly Okr[]): number | null {
  const measured = measuredObjectives(okrs);
  return measured.length === 0 ? null : Math.round(overallProgress(measured) * 100);
}

/**
 * One sentence on the objectives on screen: how far along the measured
 * ones are on average (measuredProgressPct), how many have no key result
 * yet, how many key results read off track or at risk by their
 * confidence, and how many have gone CHECK_IN_STALE_DAYS without a
 * check-in.
 */
export function okrsVerdict(okrs: readonly Okr[], filter: string, today: string): string {
  if (okrs.length === 0) return "No objectives yet.";
  const scope = filter === ALL_QUARTERS ? "" : ` for ${filter}`;
  const krs = okrs.flatMap((o) => o.keyResults ?? []);
  const measured = measuredObjectives(okrs).length;
  const pct = measuredProgressPct(okrs);
  if (pct === null) {
    return `${plural(okrs.length, "objective")}${scope}, none measured yet: add key results to measure ${
      okrs.length === 1 ? "it" : "them"
    }.`;
  }
  const unmeasured = okrs.length - measured;
  const head = `${plural(measured, "objective")}${scope} ${
    measured === 1 ? "is" : "are"
  } ${pct}% of the way${measured === 1 ? "" : " on average"}${
    unmeasured > 0 ? ` (${unmeasured} more with no key results yet)` : ""
  }`;
  const bands = krs.map((kr) => confidenceBand(kr.confidence));
  const off = bands.filter((b) => b === "off-track").length;
  const risk = bands.filter((b) => b === "at-risk").length;
  const scored = krs.filter((kr) => isConfidence(kr.confidence)).length;
  const stale = krs.filter((kr) => isStale(kr, today)).length;
  const never = krs.filter((kr) => (kr.checkIns ?? []).length === 0).length;
  const clauses: string[] = [];
  if (scored === 0) clauses.push("no key result's confidence is scored yet");
  else if (off + risk === 0) clauses.push("every scored key result reads on track");
  else
    clauses.push(
      [off ? `${off} off track` : "", risk ? `${risk} at risk` : ""].filter(Boolean).join(" and ") +
        ` by confidence`
    );
  if (stale > 0)
    clauses.push(
      `${plural(stale, "key result")} without a check-in for ${CHECK_IN_STALE_DAYS}+ days`
    );
  else if (never === krs.length) clauses.push("none checked in yet");
  return `${head}; ${clauses.join("; ")}.`;
}
