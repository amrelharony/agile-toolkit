/**
 * Release Readiness: the one-sentence answers. Each release in planning says
 * whether it's ready and what's still open; the page leads with how
 * releases have gone out, once enough have, and else with the next release.
 * Pure.
 */

import type { Release } from "@/lib/stores/workspace-types";
import type { GateResult } from "@/lib/releases/auto-gates";
import type { ReleaseStats } from "@/lib/releases/model";
import { MIN_SAMPLE, enoughData, needMore } from "@/lib/analytics/min-sample";
import { listAnd, plural } from "@/lib/charts/chart-text";
import { dayLabel, nameOf, plannedWhen, shipTiming } from "./text";

/**
 * "v3.4 is ready: all 9 gates pass." / "2 gates still open on v3.4,
 * planned in 3 days: Rollback tested and SRE review." For a release that
 * went out, how it went.
 */
export function releaseVerdict(r: Release, results: readonly GateResult[], today: string): string {
  const name = nameOf(r);
  const open = results.filter((g) => !g.passed);
  if (r.status === "planning") {
    if (results.length === 0) return `${name} has no gates to check: add some under Gates.`;
    if (open.length === 0) {
      return results.length === 1
        ? `${name} is ready: its one gate passes.`
        : `${name} is ready: all ${results.length} gates pass.`;
    }
    const what = open.length === 1 ? "1 gate still open" : `${open.length} gates still open`;
    return `${what} on ${name}, ${plannedWhen(r.plannedDate, today)}: ${listAnd(open.map((g) => g.label))}.`;
  }
  const timing = shipTiming(r.shippedDate, r.plannedDate);
  const gates =
    results.length === 0
      ? ""
      : open.length === 0
        ? " with every gate passed"
        : ` with ${open.length} of ${results.length} gates open`;
  const shipped = `${name} shipped ${dayLabel(r.shippedDate)}${timing ? ` (${timing})` : ""}${gates}`;
  if (r.status === "rolled_back") {
    return `${shipped}, and was rolled back${r.rolledBackAt ? ` ${dayLabel(r.rolledBackAt)}` : ""}.`;
  }
  return `${shipped}.`;
}

/** The release in planning planned soonest (the one the team is working towards). */
export function nextRelease(releases: readonly Release[]): Release | undefined {
  return releases
    .filter((r) => r.status === "planning")
    .sort((a, b) => (a.plannedDate || "9999").localeCompare(b.plannedDate || "9999"))[0];
}

/**
 * The page's verdict. With enough ships to quote a rate: "3 of 5 ships were
 * on time; 2 were rolled back; Rollback tested is skipped most." Before
 * then, how many more ships it needs, after the next release's readiness.
 */
export function overallVerdict({
  releases,
  stats,
  labelOf,
  next,
}: {
  releases: readonly Release[];
  stats: ReleaseStats;
  labelOf: (gateId: string) => string;
  /** The next release in planning and its verdict, if there is one. */
  next?: string;
}): string {
  if (releases.length === 0) return "No releases yet.";
  const ships = stats.shipped;
  if (!enoughData(ships, "average")) {
    const more = needMore(ships, "average");
    const sofar =
      ships === 0
        ? "Nothing has shipped yet"
        : `${plural(ships, "ship")} so far: ${more} more to see how often releases go out on time`;
    return next ? `${next.replace(/\.$/, "")}. ${sofar}.` : `${sofar}.`;
  }
  const onTime = `${stats.onTime} of ${ships} ships were on time`;
  const rolledBack =
    stats.rolledBack === 0
      ? "none was rolled back"
      : stats.rolledBack === 1
        ? "1 was rolled back"
        : `${stats.rolledBack} were rolled back`;
  const top = stats.skippedByGate.find((g) => g.skipped > 0);
  const skipped = top ? `${labelOf(top.gateId)} is skipped most` : "no gate was skipped";
  return `${onTime}; ${rolledBack}; ${skipped}.`;
}

/** Shown with the % on time while it's hidden. */
export const ON_TIME_MIN = MIN_SAMPLE.average;
