/**
 * The kit's example task, its lite half: what a page imports. No zod, so
 * the page doesn't ship the schemas; they load on the first AI use, from
 * `_example.ts` (lib/ai/task-ref).
 *
 * Every tool's task follows this pattern:
 *   - here: the zod-free values pages use, the fallback as a named function,
 *     and one ref per task, with the def's export name;
 *   - `_example.ts`: the def, with its schemas and this same fallback;
 *   - `_example.server.ts`: the prompt.
 */

import { lazyAiTask } from "../task-ref";
import type { SuggestOptionsInput, SuggestOptionsOutput } from "./_example";
export type { SuggestOptionsInput, SuggestOptionsOutput } from "./_example";

export const SUGGEST_OPTIONS_MAX = 6;

const YES_NO =
  /^(should|shall|do|does|did|is|are|was|were|can|could|will|would|have|has|may|might|must)\b/i;
const HOW_MUCH = /\bhow (confident|sure|happy|likely|ready|clear|comfortable)\b/i;

/** What the fallback gives a question it can't read: blanks to fill in, not answers. */
export const BLANK_OPTIONS: readonly string[] = ["First option", "Second option", "Third option"];

/** The fallback's blanks: a page shows a line asking for the person's own options instead. */
export function isBlankOptions(options: readonly string[]): boolean {
  return options.length === BLANK_OPTIONS.length && options.every((o, i) => o === BLANK_OPTIONS[i]);
}

/**
 * Options without AI, from the question's shape: a confidence scale for "how
 * confident/sure/ready…", yes / no / not sure for a yes-no question, and
 * three blanks to fill in for anything else (`isBlankOptions`).
 */
export function fallbackOptions(question: string): string[] {
  const q = question.trim();
  if (HOW_MUCH.test(q)) return ["Very", "Mostly", "Somewhat", "Not really", "Not at all"];
  if (YES_NO.test(q)) return ["Yes", "No", "Not sure"];
  return [...BLANK_OPTIONS];
}

/** The task's answer without AI. */
export const suggestOptionsFallback = ({
  question,
}: SuggestOptionsInput): SuggestOptionsOutput => ({
  options: fallbackOptions(question),
});

export const suggestOptionsTask = lazyAiTask<SuggestOptionsInput, SuggestOptionsOutput>(
  { id: "ai.suggest_options", toolId: "ai", fallback: suggestOptionsFallback },
  () => import("./_example").then((m) => m.suggestOptionsTask)
);
