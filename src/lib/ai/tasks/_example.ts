/**
 * The kit's own example task, and the pattern every tool's task follows:
 * suggest answer options for a poll question (Quick Vote reuses it).
 *
 * This half is browser-safe: schemas with hard caps, a fallback that needs no
 * model, and a sample input. The prompt lives in `_example.server.ts`. Register
 * both halves in `index.ts` and `index.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";

export const SUGGEST_OPTIONS_MAX = 6;

const input = z.object({
  question: z.string().trim().min(3).max(280),
});

const output = z.object({
  options: z.array(z.string().trim().min(1).max(60)).min(2).max(SUGGEST_OPTIONS_MAX),
});

const YES_NO =
  /^(should|shall|do|does|did|is|are|was|were|can|could|will|would|have|has|may|might|must)\b/i;
const HOW_MUCH = /\bhow (confident|sure|happy|likely|ready|clear|comfortable)\b/i;

/**
 * Options without AI, from the question's shape: a confidence scale for "how
 * confident/sure/ready…", yes / no / not sure for a yes-no question, and
 * three blanks to fill in for anything else.
 */
export function fallbackOptions(question: string): string[] {
  const q = question.trim();
  if (HOW_MUCH.test(q)) return ["Very", "Mostly", "Somewhat", "Not really", "Not at all"];
  if (YES_NO.test(q)) return ["Yes", "No", "Not sure"];
  return ["First option", "Second option", "Third option"];
}

export const suggestOptionsTask = defineAiTask({
  id: "ai.suggest_options",
  toolId: "ai",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: ({ question }) => ({ options: fallbackOptions(question) }),
  sample: { question: "Which day should we move the sprint review to?" },
});
