import type { RetroActionSummary, RetroFollowThrough } from "@/lib/retro/actions";
import { enoughData } from "@/lib/analytics/min-sample";
import { pct, ratedRetros, totals } from "./follow-through";

/** How many recent retros the verdict sums: one retro's count is noise, a quarter's is history. */
export const VERDICT_RETROS = 3;

/** A change in follow-through smaller than this (in points) reads as "about the same". */
const LEVEL_POINTS = 10;

/** "5 actions open, 1 overdue", or that nothing is open. */
function openPart(summary: RetroActionSummary): string {
  const total = summary.open + summary.done;
  if (summary.open === 0) {
    return total === 1
      ? "Nothing open: the one action is done"
      : `Nothing open: all ${total} actions are done`;
  }
  const open = `${summary.open} ${summary.open === 1 ? "action" : "actions"} open`;
  return summary.overdue > 0 ? `${open}, ${summary.overdue} overdue` : open;
}

/**
 * "the last 3 retros got 7 of 12 actions done (58%)": the recent retros'
 * follow-through. The percentage needs MIN_SAMPLE.average actions behind
 * it, and the comparison with the retros before needs MIN_SAMPLE.trend
 * rated retros, so two retros of one action each never read as a trend.
 */
function followThroughPart(rows: readonly RetroFollowThrough[]): string | null {
  const rated = ratedRetros(rows);
  if (rated.length === 0) return null;
  const recent = rated.slice(-VERDICT_RETROS);
  const { agreed, done } = totals(recent);
  const who = recent.length === 1 ? "the last retro" : `the last ${recent.length} retros`;
  let part = `${who} got ${done} of ${agreed} ${agreed === 1 ? "action" : "actions"} done`;
  if (!enoughData(agreed, "average")) return part;
  part += ` (${pct(done / agreed)})`;
  if (!enoughData(rated.length, "trend")) return part;
  const before = totals(rated.slice(-2 * VERDICT_RETROS, -VERDICT_RETROS));
  if (!enoughData(before.agreed, "average")) return part;
  const now = done / agreed;
  const then = before.done / before.agreed;
  const points = Math.round((now - then) * 100);
  if (Math.abs(points) < LEVEL_POINTS)
    return `${part}, about the same as the ${VERDICT_RETROS} before`;
  return `${part}, ${points > 0 ? "up" : "down"} from ${pct(then)} in the ${VERDICT_RETROS} before`;
}

/**
 * The one-sentence answer above the list: what is still open, and whether
 * the team does what it agrees in its retros.
 */
export function retroActionsVerdict(
  summary: RetroActionSummary,
  followThrough: readonly RetroFollowThrough[]
): string {
  if (summary.open + summary.done === 0) return "No action items yet.";
  const rate = followThroughPart(followThrough);
  return rate ? `${openPart(summary)}; ${rate}.` : `${openPart(summary)}.`;
}
