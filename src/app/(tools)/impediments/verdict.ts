import type { Impediment } from "@/lib/stores/workspace-types";
import {
  compareImpediments,
  daysOverdue,
  impedimentAgeDays,
  impedimentStatus,
  impedimentSummary,
} from "@/lib/impediments/model";
import { enoughData } from "@/lib/analytics/min-sample";
import { avgDaysText, daysText, resolutionDays, titleOf } from "./helpers";

/**
 * The one-sentence answer above the list: how much is in the way, and the
 * one to chase first (the longest overdue, else the oldest unresolved).
 *
 *   "4 open, 1 escalated; 1 overdue: Build server down, by 3 days."
 */
export function impedimentVerdict(list: readonly Impediment[], today: string): string {
  if (list.length === 0) return "No impediments logged yet.";
  const s = impedimentSummary(list, today);
  const unresolved = list.filter((i) => impedimentStatus(i) !== "resolved");

  if (unresolved.length === 0) {
    const took = resolutionDays(list);
    const avg = enoughData(took.length, "average")
      ? `, in ${avgDaysText(s.avgResolutionDays)} on average`
      : "";
    return list.length === 1
      ? "Nothing in the way: the one impediment logged is resolved."
      : `Nothing in the way: all ${list.length} impediments are resolved${avg}.`;
  }

  const counts = [
    s.open > 0 ? `${s.open} open` : "",
    s.escalated > 0 ? `${s.escalated} escalated` : "",
  ]
    .filter(Boolean)
    .join(", ");

  // Longest overdue first; a tie goes to the one the list puts first.
  const overdue = unresolved
    .map((i) => ({ i, by: daysOverdue(i, today) }))
    .filter((x) => x.by > 0)
    .sort((a, b) => b.by - a.by || compareImpediments(a.i, b.i, today));
  if (overdue.length > 0) {
    const { i, by } = overdue[0];
    const which = overdue.length === 1 ? "1 overdue" : `${overdue.length} overdue, the longest`;
    return `${counts}; ${which}: ${titleOf(i)}, by ${daysText(by)}.`;
  }

  const oldest = unresolved
    .map((i) => ({ i, age: impedimentAgeDays(i, today) }))
    .filter((x): x is { i: Impediment; age: number } => x.age !== null)
    .sort((a, b) => b.age - a.age || compareImpediments(a.i, b.i, today))[0];
  if (!oldest) return `${counts}; none overdue.`;
  const age = oldest.age === 0 ? "raised today" : `open ${daysText(oldest.age)}`;
  return `${counts}; none overdue. The oldest is ${titleOf(oldest.i)}, ${age}.`;
}
