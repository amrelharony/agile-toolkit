/**
 * The A/B Calculator's AI task, the lite half pages import (no zod; the
 * def, with its schemas, is `ab-calculator.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import type { AbPlanCheckInput, AbPlanCheckOutput } from "./ab-calculator";
export type { AbPlanCheckInput, AbPlanCheckOutput } from "./ab-calculator";

/** The test's name as the task takes it. */
export const AB_NAME_MAX = 200;
/** Its question and the hypothesis it tests: the first 500 characters say enough. */
export const AB_TEXT_MAX = 500;
/** The metric's name. */
export const AB_METRIC_MAX = 120;
/** At most three guardrails, as a test keeps (TOOL_LIST_MAX.abGuardrails). */
export const AB_GUARDRAILS_MAX = 3;
/** At most four risks to check. */
export const AB_RISKS_MAX = 4;
/** A guardrail's name and why, and a risk, as the answer may hold them. */
export const AB_GUARDRAIL_NAME_MAX = 120;
export const AB_LINE_MAX = 200;

/** The metric a test moves when nobody named one. */
export const DEFAULT_METRIC = "conversion rate";

/** Guardrails a conversion test watches without AI: what a win could hurt. */
export const FALLBACK_GUARDRAILS: AbPlanCheckOutput["guardrails"] = [
  {
    name: "Error rate",
    why: "B could convert more people while the step breaks for others.",
  },
  {
    name: "Time to finish the step",
    why: "A change can win on conversion and still make the step slower for everyone.",
  },
  {
    name: "Cancellations and refunds",
    why: "More sign-ups who leave within a week aren't a win.",
  },
];

/** The checks every plan should pass, in our own words. */
export const FALLBACK_RISKS: AbPlanCheckOutput["risks"] = [
  "Decide the sample size before the test starts, and don't stop it early when it first looks good.",
  "Run whole weeks, so weekdays and weekends both count.",
  "Pick one main metric before it starts; the guardrails only check for harm.",
  "Check the split: each version should get about half the visitors.",
];

/**
 * The task's input from a test as the page holds it: every text trimmed and
 * cut to the task's caps, and the metric named even when it wasn't.
 */
export function planCheckInput(test: {
  name: string;
  question?: string;
  metricName?: string;
  hypothesis?: string;
}): AbPlanCheckInput {
  const cut = (s: string | undefined, max: number) =>
    (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const question = cut(test.question, AB_TEXT_MAX);
  const hypothesis = cut(test.hypothesis, AB_TEXT_MAX);
  return {
    name: cut(test.name, AB_NAME_MAX) || "A/B test",
    ...(question ? { question } : {}),
    metricName: cut(test.metricName, AB_METRIC_MAX) || DEFAULT_METRIC,
    ...(hypothesis ? { hypothesis } : {}),
  };
}

/** The task's answer without AI: the fixed guardrails and checks. Never a number. */
export const abPlanCheckFallback = (input: AbPlanCheckInput): AbPlanCheckOutput => {
  void input;
  return {
    guardrails: FALLBACK_GUARDRAILS.map((g) => ({ ...g })),
    risks: [...FALLBACK_RISKS],
  };
};

export const abPlanCheckTask = lazyAiTask<AbPlanCheckInput, AbPlanCheckOutput>(
  { id: "ab-calculator.plan_check", toolId: "ab-calculator", fallback: abPlanCheckFallback },
  () => import("./ab-calculator").then((m) => m.abPlanCheckTask)
);
