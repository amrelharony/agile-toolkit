import { listAnd } from "@/lib/charts/chart-text";
import { dueText } from "@/lib/prioritization/methods/eisenhower";
import type { RankedRow } from "@/lib/prioritization/rank";
import { compareTasks, eisGroups, shortName, type EisGroup } from "./model";

const quoted = (title: string) => `“${shortName(title)}”`;

/**
 * The answer over the matrix: what to do first, then what the other panes
 * hold. The first Do task is the one due soonest (an overdue one first).
 *
 *   "Do “Fix the login outage” first (2 days overdue), then 1 more; 2 to
 *    schedule, 2 to delegate (1 with nobody named), 1 to drop and 1 not
 *    sorted yet."
 */
export function eisVerdict(rows: readonly RankedRow[], today: string): string {
  if (rows.length === 0) return "No tasks yet.";
  // Sorted here, not as shown: the verdict names the task due soonest even
  // while the panes hold still for an edit.
  const sorted = [...rows].sort(compareTasks(today));
  const g = Object.fromEntries(eisGroups(sorted, today).map((x) => [x.id, x])) as Record<
    EisGroup["id"],
    EisGroup
  >;
  const sortedCount = rows.length - g.unsorted.tasks.length;
  if (sortedCount === 0) {
    return rows.length === 1
      ? "Say whether the task is urgent and important to sort it."
      : `Say whether each of the ${rows.length} tasks is urgent and important to sort them.`;
  }

  let lead: string;
  const doing = g.do.tasks;
  if (doing.length > 0) {
    const first = doing[0];
    const when = first.urgency.daysToDue === null ? "" : ` (${dueText(first.urgency.daysToDue)})`;
    lead = `Do ${quoted(first.ranked.row.title)} first${when}`;
    if (doing.length > 1) lead += `, then ${doing.length - 1} more`;
  } else if (g.schedule.tasks.length > 0) {
    lead = `Nothing is urgent and important: block time for ${quoted(g.schedule.tasks[0].ranked.row.title)}`;
  } else {
    lead = "Nothing is urgent and important";
  }

  const nobody = g.delegate.tasks.filter((t) => !t.delegateTo).length;
  const scheduled = g.schedule.tasks.length;
  const rest = [
    // A lone Schedule task the lead already names isn't counted again.
    scheduled > 0 && (doing.length > 0 || scheduled > 1) && `${scheduled} to schedule`,
    g.delegate.tasks.length > 0 &&
      `${g.delegate.tasks.length} to delegate${nobody > 0 ? ` (${nobody} with nobody named)` : ""}`,
    g.delete.tasks.length > 0 && `${g.delete.tasks.length} to drop`,
    g.unsorted.tasks.length > 0 && `${g.unsorted.tasks.length} not sorted yet`,
  ].filter((x): x is string => Boolean(x));
  return rest.length > 0 ? `${lead}; ${listAnd(rest)}.` : `${lead}.`;
}
