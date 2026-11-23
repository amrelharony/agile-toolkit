/**
 * Test Sessions' AI task, the lite half pages import (no zod; the def, with
 * its schemas, is `test-sessions.ts` and loads on first AI use): the caps,
 * the charters without AI, and the ref.
 */

import { lazyAiTask } from "../task-ref";
import { chartersByLenses } from "@/lib/test-sessions/model";
import type { ChartersInput, ChartersOutput } from "./test-sessions";
export type { ChartersInput, ChartersOutput, CharterSuggestion } from "./test-sessions";

/** The task's id, as the request names it. */
export const CHARTERS_TASK_ID = "test-sessions.charters";

export const CHARTERS_TARGET_MAX = 200;
/** A story's notes, criteria and Given/When/Then, joined. */
export const CHARTERS_DETAILS_MAX = 2000;
export const CHARTERS_RISKS_MAX = 10;
export const CHARTERS_RISK_MAX = 200;
/** Past charters' sentences sent along, to skip repeats. */
export const CHARTERS_PAST_MAX = 20;
export const CHARTERS_PAST_TEXT_MAX = 300;
export const CHARTERS_COUNT_MAX = 6;
export const CHARTER_USING_MAX = 200;
export const CHARTER_LEARN_MAX = 300;
export const CHARTER_WHY_MAX = 200;

const cut = (v: string, max: number) => (v.length > max ? v.slice(0, max) : v);

/**
 * The charters without AI: one per Given/When/Then row in the details, then
 * the ten lenses ranked by the words they share with the target, details
 * and risks, skipping lenses a past charter used (`chartersByLenses`).
 */
export function fallbackCharters({
  target,
  details,
  risks,
  past,
  count,
}: ChartersInput): ChartersOutput {
  return {
    charters: chartersByLenses({ target, details, risks, past, count }).map((c) => ({
      target: cut(c.target, CHARTERS_TARGET_MAX),
      using: cut(c.using, CHARTER_USING_MAX),
      toLearn: cut(c.toLearn, CHARTER_LEARN_MAX),
      minutes: c.minutes,
      why: cut(c.why, CHARTER_WHY_MAX),
    })),
  };
}

export const testSessionsChartersTask = lazyAiTask<ChartersInput, ChartersOutput>(
  { id: CHARTERS_TASK_ID, toolId: "test-sessions", fallback: fallbackCharters },
  () => import("./test-sessions").then((m) => m.testSessionsChartersTask)
);
