/**
 * Velocity in one sentence, from the same numbers as the tiles: the shared
 * velocity (the last 3 finished sprints by end date), how many of those
 * sprints met their commitment (90–110%, the graded say/do), and the points
 * per person-day when the sprints had capacity plans.
 */

import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { fmt } from "@/lib/sprints/hub-view";
import { perDayText, type VelocityRow, type VelocitySummary } from "./view";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function velocityVerdict(
  rows: readonly VelocityRow[],
  summary: Pick<VelocitySummary, "velocity" | "perPersonDay">
): string {
  if (rows.length === 0) return "No sprints yet: add one to start tracking velocity.";
  const { velocity, perPersonDay } = summary;
  if (velocity.average === null) {
    const open = rows.filter((r) => r.status === "planned" || r.status === "active").length;
    return open > 0
      ? `No finished sprints yet: close ${open === 1 ? "the sprint" : "a sprint"} with its completed points to see the velocity.`
      : "No finished sprints yet: a sprint counts once it is done with its completed points.";
  }
  const window = new Set(velocity.sprintIds);
  const inWindow = rows.filter((r) => window.has(r.id));
  const graded = inWindow.filter((r) => r.sayDo !== null);
  const met = graded.filter((r) => r.sayDo?.grade === "met").length;
  const over = `the last ${velocity.count === 1 ? "sprint" : plural(velocity.count, "sprint")}`;
  const parts = [
    `Velocity is ${fmt(velocity.average)} points over ${over}`,
    graded.length === 0
      ? "none of them had a commitment to meet"
      : graded.length === 1
        ? met === 1
          ? "it met its commitment"
          : "it didn't meet its commitment (90–110%)"
        : `${met} of ${graded.length} met the commitment`,
  ];
  if (perPersonDay.average !== null && perPersonDay.count >= MIN_SAMPLE.average) {
    parts.push(`${perDayText(perPersonDay.average)} points per person-day`);
  }
  const few =
    velocity.count < MIN_SAMPLE.average ? " Close more sprints before planning on it." : "";
  return `${parts.join("; ")}.${few}`;
}
