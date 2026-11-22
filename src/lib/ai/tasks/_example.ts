/**
 * The kit's own example task, and the pattern every tool's task follows:
 * suggest answer options for a poll question (Quick Vote reuses it).
 *
 * This half is the def: schemas with hard caps, the fallback that needs no
 * model, and a sample input. Pages import the lite half (`_example.lite.ts`:
 * the fallback, the caps and a ref that loads this module on first use);
 * the routes, the registry and the tests read this one. The prompt lives in
 * `_example.server.ts`. Register this def in `index.ts` and the prompt in
 * `index.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { SUGGEST_OPTIONS_MAX, suggestOptionsFallback } from "./_example.lite";

export {
  BLANK_OPTIONS,
  SUGGEST_OPTIONS_MAX,
  fallbackOptions,
  isBlankOptions,
  suggestOptionsFallback,
} from "./_example.lite";

const input = z.object({
  question: z.string().trim().min(3).max(280),
});

const output = z.object({
  options: z.array(z.string().trim().min(1).max(60)).min(2).max(SUGGEST_OPTIONS_MAX),
});

export type SuggestOptionsInput = z.infer<typeof input>;
export type SuggestOptionsOutput = z.infer<typeof output>;

export const suggestOptionsTask = defineAiTask({
  id: "ai.suggest_options",
  toolId: "ai",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: suggestOptionsFallback,
  sample: { question: "Which day should we move the sprint review to?" },
});
