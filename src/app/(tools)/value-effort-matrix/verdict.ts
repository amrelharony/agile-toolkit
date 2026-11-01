import { listAnd, plural } from "@/lib/charts/chart-text";
import type { RankedRow } from "@/lib/prioritization/rank";
import { shortName, veGroups } from "./model";

/** Quick Wins named in the lead; the rest are counted. */
const NAMED = 3;

const quoted = (r: RankedRow) => `“${shortName(r.row.title)}”`;

/**
 * The answer above the matrix (and its summary), in one sentence: where
 * to start, then what the other quadrants hold. Rows come ranked
 * (rankMethodRows), so the Quick Wins are named best value ÷ effort first.
 *
 *   "Start with “A” and “B”, your 2 Quick Wins; 3 Big Bets to plan, 1 Time Waster to drop and 1 not placed yet."
 */
export function veVerdict(rows: readonly RankedRow[]): string {
  if (rows.length === 0) return "No items yet.";
  const g = Object.fromEntries(veGroups(rows).map((x) => [x.id, x.rows])) as Record<
    string,
    RankedRow[]
  >;
  const placed = rows.length - g.unplaced.length;
  if (placed === 0) {
    return rows.length === 1
      ? "Place the item on the matrix to see where to start."
      : `Place the ${rows.length} items on the matrix to see where to start.`;
  }

  const wins = g.quick_wins;
  let lead: string;
  if (wins.length === 0) {
    lead =
      g.big_bets.length > 0
        ? "No Quick Wins yet: split a Big Bet into smaller pieces"
        : "No Quick Wins yet";
  } else {
    const names = wins.slice(0, NAMED).map(quoted);
    const more = wins.length - names.length;
    lead =
      more > 0
        ? `Start with ${listAnd(names)} of your ${plural(wins.length, "Quick Win")}`
        : wins.length === 1
          ? `Start with ${names[0]}, your one Quick Win`
          : `Start with ${listAnd(names)}, your ${plural(wins.length, "Quick Win")}`;
  }

  const rest = [
    g.big_bets.length > 0 && `${plural(g.big_bets.length, "Big Bet")} to plan`,
    g.fill_ins.length > 0 && `${plural(g.fill_ins.length, "Fill-In")} for spare time`,
    g.time_wasters.length > 0 && `${plural(g.time_wasters.length, "Time Waster")} to drop`,
    g.unplaced.length > 0 && `${g.unplaced.length} not placed yet`,
  ].filter((x): x is string => Boolean(x));
  return rest.length > 0 ? `${lead}; ${listAnd(rest)}.` : `${lead}.`;
}
