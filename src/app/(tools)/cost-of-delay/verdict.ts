import { shortName } from "@/components/prioritization/method-tool";
import { COST_OF_DELAY } from "@/lib/prioritization/methods";
import type { RankedRow } from "@/lib/prioritization/rank";
import { todayIso } from "@/lib/sprints/series";
import { listAnd, plural } from "@/lib/charts/chart-text";
import { dayText, fixedDateStart, laneOf } from "./lanes";

const quoted = (r: RankedRow) => `“${shortName(r.row.title)}”`;
const cd3Of = (r: RankedRow) => COST_OF_DELAY.format(r.result.score as number);

/**
 * The answer over the lanes, in the order work should start: expedite
 * items now, the fixed date whose latest start comes first (or is already
 * past), then the highest CD3 of the rest; and what still waits for a
 * duration or a profile. Lanes and CD3 are the registry's.
 */
export function codVerdict(rows: readonly RankedRow[], today: string = todayIso()): string {
  if (rows.length === 0) return "No initiatives yet.";
  const scored = rows.filter((r) => r.result.score !== null);
  const unscored = rows.length - scored.length;
  const waiting =
    unscored > 0 ? ` ${plural(unscored, "initiative")} not scored yet: add a duration.` : "";
  if (scored.length === 0) {
    return `None of the ${plural(rows.length, "initiative")} is scored yet: add a duration.`;
  }

  const parts: string[] = [];
  const expedite = scored.filter((r) => laneOf(r) === "expedite");
  if (expedite.length > 0) parts.push(`Expedite ${listAnd(expedite.map(quoted))} now.`);

  // The rows come in the registry's order, so the first fixed date with a
  // start is the one that must start soonest.
  const fixed = scored.map((r) => ({ r, s: fixedDateStart(r, today) })).find((x) => x.s);
  if (fixed?.s) {
    const start = dayText(fixed.s.latestStart, today);
    const land = dayText(fixed.s.fixedDate, today);
    parts.push(
      fixed.s.late
        ? `${quoted(fixed.r)} is late: it had to start by ${start} to land by ${land}.`
        : `${quoted(fixed.r)} must start by ${start} to land by ${land}.`
    );
  }

  const rest = scored.filter((r) => laneOf(r) !== "expedite" && laneOf(r) !== "fixed_date");
  if (rest.length > 0) {
    const top = rest[0];
    parts.push(
      parts.length > 0
        ? `Of the rest, do ${quoted(top)} first (CD3 ${cd3Of(top)}).`
        : `Do first: ${quoted(top)} (CD3 ${cd3Of(top)}).`
    );
  }

  const noLane = scored.filter((r) => laneOf(r) === "none").length;
  const lanes =
    noLane > 0
      ? ` ${plural(noLane, "initiative has", "initiatives have")} no urgency profile yet.`
      : "";
  return `${parts.join(" ")}${lanes}${waiting}`;
}
