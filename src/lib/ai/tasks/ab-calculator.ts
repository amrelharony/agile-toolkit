/**
 * The A/B Calculator's AI task, the def: guardrail metrics to watch and the
 * risks to check in a planned conversion test, from its name, its question,
 * its main metric and the hypothesis it tests. It never gives or sets a
 * number: the sample size and the reading are the page's own maths. The
 * person accepts each item; an accepted guardrail joins the test's
 * guardrails and an accepted risk its note, with Undo.
 *
 * Without AI the page offers fixed guardrails for a conversion test and the
 * checks every plan should pass (`ab-calculator.lite.ts`, which pages
 * import). The prompt is in `ab-calculator.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import {
  AB_GUARDRAILS_MAX,
  AB_GUARDRAIL_NAME_MAX,
  AB_LINE_MAX,
  AB_METRIC_MAX,
  AB_NAME_MAX,
  AB_RISKS_MAX,
  AB_TEXT_MAX,
  abPlanCheckFallback,
} from "./ab-calculator.lite";

export {
  AB_GUARDRAILS_MAX,
  AB_GUARDRAIL_NAME_MAX,
  AB_LINE_MAX,
  AB_METRIC_MAX,
  AB_NAME_MAX,
  AB_RISKS_MAX,
  AB_TEXT_MAX,
  FALLBACK_GUARDRAILS,
  FALLBACK_RISKS,
  abPlanCheckFallback,
  planCheckInput,
} from "./ab-calculator.lite";

const input = z.object({
  name: z.string().trim().min(1).max(AB_NAME_MAX),
  question: z.string().trim().max(AB_TEXT_MAX).optional(),
  metricName: z.string().trim().min(1).max(AB_METRIC_MAX),
  hypothesis: z.string().trim().max(AB_TEXT_MAX).optional(),
});

const output = z.object({
  guardrails: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(AB_GUARDRAIL_NAME_MAX),
        why: z.string().trim().min(1).max(AB_LINE_MAX),
      })
    )
    .max(AB_GUARDRAILS_MAX),
  risks: z.array(z.string().trim().min(1).max(AB_LINE_MAX)).max(AB_RISKS_MAX),
});

export type AbPlanCheckInput = z.infer<typeof input>;
export type AbPlanCheckOutput = z.infer<typeof output>;

export const abPlanCheckTask = defineAiTask({
  id: "ab-calculator.plan_check",
  toolId: "ab-calculator",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: abPlanCheckFallback,
  sample: {
    name: "Shorter sign-up form",
    question: "Does cutting the sign-up form to three fields lift sign-ups?",
    metricName: "sign-up conversion",
    hypothesis: "a shorter sign-up form gets more visitors to finish signing up",
  },
});
