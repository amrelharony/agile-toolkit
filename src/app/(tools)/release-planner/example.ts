import { exampleId } from "@/components/tool-frame/example-data";
import { todayIso } from "@/lib/sprints/series";
import { addDaysIso } from "./forecast";
import type { ReleasePlannerConfig } from "./store";

export const EXAMPLE_ID = exampleId("release-plan");

/**
 * A team asked whether a payments release can ship in about four months:
 * 180 points left, 15% growth expected as the work is understood, and
 * eight sprints of history with one bad sprint (14) in it. The date is a
 * long shot, which is the point of the example: the verdict says what gets
 * it to 85% (a sprint later, or about 20 points less).
 *
 * Everything is typed, so the example never reads or writes the user's
 * sprints or stories; "Clear example" empties exactly these fields.
 */
export function buildExample(today: string = todayIso()): Partial<ReleasePlannerConfig> {
  return {
    example: EXAMPLE_ID,
    scopeSource: "typed",
    backlogSize: 180,
    scopeChangePct: 15,
    velocitySource: "manual",
    velocityInput: "23, 19, 27, 14, 22, 25, 21, 26",
    targetDate: addDaysIso(today, 7 * 18),
  };
}

/** The fields the example sets, back to empty ("Clear example"). */
export const CLEARED_EXAMPLE: Partial<ReleasePlannerConfig> = {
  example: undefined,
  scopeSource: undefined,
  backlogSize: null,
  scopeChangePct: null,
  velocitySource: undefined,
  velocityInput: "",
  targetDate: "",
};
