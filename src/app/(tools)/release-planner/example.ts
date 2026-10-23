import { exampleId } from "@/components/tool-frame/example-data";
import { todayIso } from "@/lib/sprints/series";
import { addDaysIso } from "@/lib/sprints/release-forecast";
import { pickExampleFields, type ReleasePlannerConfig } from "./store";

export const EXAMPLE_ID = exampleId("release-plan");

/**
 * A team asked whether a payments release can ship in about four months:
 * 180 points left, 15% growth expected as the work is understood, and
 * eight sprints of history with one bad sprint (14) in it. The date is a
 * long shot, which is the point of the example: the verdict says what gets
 * it to 85% (a sprint later, or about 20 points less).
 *
 * Everything is typed, so the example never reads or writes the user's
 * sprints or stories; "Clear example" puts these fields back as they were
 * (see `withExample`).
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
  beforeExample: undefined,
  scopeSource: undefined,
  backlogSize: null,
  scopeChangePct: null,
  velocitySource: undefined,
  velocityInput: "",
  targetDate: "",
};

/**
 * The example loaded over `config`, keeping what its fields held. The
 * empty state offers the example before any scope or velocity exists, but
 * a target date or scope change may already be set: those come back on
 * "Clear example" instead of being lost.
 */
export function withExample(
  config: ReleasePlannerConfig,
  today: string = todayIso()
): Partial<ReleasePlannerConfig> {
  return { ...buildExample(today), beforeExample: pickExampleFields(config) };
}

/** "Clear example": the example's fields as they were before it loaded (empty for an older save without them). */
export function clearedExample(config: ReleasePlannerConfig): Partial<ReleasePlannerConfig> {
  return { ...CLEARED_EXAMPLE, ...(config.beforeExample ?? {}) };
}
