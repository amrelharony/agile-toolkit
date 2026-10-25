/**
 * Velocity in one sentence, from the same numbers as the tiles: the shared
 * velocity (the last 3 finished sprints by end date), how many of the last
 * sprints with a commitment met it (90–110%, the graded say/do over the
 * "Met the commitment" tile's window), and the points per person-day when
 * the sprints had capacity plans. Each part names the sprints it counts.
 */

import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { fmt } from "@/lib/sprints/hub-view";
import type { SayDoGrade } from "@/lib/sprints/metrics";
import { perDayText, type VelocityRow, type VelocitySummary } from "./view";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One sprint's grade, as a verb phrase: over-delivery isn't a miss. */
const GRADE_PHRASE: Record<SayDoGrade, string> = {
  met: "met it",
  close: "came close to it",
  missed: "missed it",
  over: "did more than it committed",
};

export function velocityVerdict(
  rows: readonly VelocityRow[],
  summary: Pick<VelocitySummary, "velocity" | "sayDo" | "perPersonDay">
): string {
  if (rows.length === 0) return "No sprints yet: add one to start tracking velocity.";
  const { velocity, sayDo, perPersonDay } = summary;
  if (velocity.average === null) {
    const open = rows.filter((r) => r.status === "planned" || r.status === "active").length;
    return open > 0
      ? `No finished sprints yet: close ${open === 1 ? "the sprint" : "a sprint"} with its completed points to see the velocity.`
      : "No finished sprints yet: a sprint counts once it is done with its completed points.";
  }
  const over = `the last ${velocity.count === 1 ? "sprint" : plural(velocity.count, "sprint")}`;
  const [only] = sayDo.sprints;
  const parts = [
    `Velocity is ${fmt(velocity.average)} points over ${over}`,
    sayDo.count === 0
      ? "no finished sprint had a commitment to meet"
      : sayDo.count === 1 && only
        ? `the one sprint with a commitment ${GRADE_PHRASE[only.grade]} (${only.pct}%)`
        : `${sayDo.byGrade.met} of the last ${sayDo.count} sprints with a commitment met it (90–110%)`,
  ];
  if (perPersonDay.average !== null && perPersonDay.count >= MIN_SAMPLE.average) {
    parts.push(`${perDayText(perPersonDay.average)} points per person-day`);
  }
  const few =
    velocity.count < MIN_SAMPLE.average ? " Close more sprints before planning on it." : "";
  return `${parts.join("; ")}.${few}`;
}
