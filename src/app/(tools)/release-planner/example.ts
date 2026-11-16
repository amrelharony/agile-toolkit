import { exampleId } from "@/components/tool-frame/example-data";
import { todayIso } from "@/lib/sprints/series";
import { addDaysIso } from "@/lib/sprints/release-forecast";
import { pickExampleFields, type ReleasePlannerConfig } from "./store";
import type { ReleaseFeature } from "./throughput";

export const EXAMPLE_ID = exampleId("release-plan");

/** The example's features, in the order the Product Owner wants them. */
export const EXAMPLE_FEATURES: ReleaseFeature[] = [
  { id: exampleId("feature-saved-cards"), name: "Saved cards", items: 14 },
  { id: exampleId("feature-refunds"), name: "Self-serve refunds", items: 18 },
  { id: exampleId("feature-receipts"), name: "Email receipts", items: 9 },
  { id: exampleId("feature-wallets"), name: "Phone wallets", items: 16 },
];

/**
 * A team asked whether a payments release can ship in about four months:
 * 180 points left, 15% growth expected as the work is understood, and
 * eight sprints of history with one bad sprint (14) in it. The date is a
 * long shot, which is the point of the example: the verdict says what gets
 * it to 85% (a sprint later, or about 20 points less).
 *
 * Counted in items instead, the same team has 48 items left and finished
 * between 0 and 7 a week over the last twelve weeks (one quiet week, a
 * holiday). Four features stand in order, so the cut line shows which ones
 * the date reaches.
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
    throughputSource: "typed",
    throughputInput: "4, 6, 3, 5, 0, 7, 4, 5, 6, 3, 5, 4",
    itemsSource: "typed",
    itemsCount: 48,
    features: EXAMPLE_FEATURES,
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
  throughputSource: undefined,
  throughputInput: undefined,
  itemsSource: undefined,
  itemsCount: undefined,
  features: undefined,
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
