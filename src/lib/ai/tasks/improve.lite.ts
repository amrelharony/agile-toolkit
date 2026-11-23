/**
 * Improve's AI task, the lite half pages import (no zod; the def, with its
 * schemas, is `improve.ts` and loads on the first AI use): the next
 * experiment's caps, its templates without AI, the ref, and the fitter for
 * the Root Cause countermeasure task an A3 reuses.
 */

import { lazyAiTask } from "../task-ref";
import { TOOL_AI_BODY_BUDGET } from "../contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import type { CountermeasureInput } from "./root-cause.lite";
import type { NextExperimentInput, NextExperimentOutput } from "./improve";
export type { NextExperimentInput, NextExperimentOutput } from "./improve";

/** Experiments one ask returns: alternatives, the person picks one. */
export const EXPERIMENTS_MAX = 3;

/** The input's caps (the def's schema holds the same numbers). */
export const EXPERIMENT_INPUT_MAX = {
  challenge: 1000,
  target: 1000,
  current: 1000,
  metric: 200,
  obstacle: 300,
  past: 10,
  pastField: 300,
} as const;

/** An experiment's caps in the answer. */
export const EXPERIMENT_OUTPUT_MAX = { step: 200, expect: 200 } as const;

/** "“Reviews wait for one person”" for a template, cut to fit. */
function quoted(text: string, max = 120): string {
  const t = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/, "");
  return `“${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}”`;
}

/**
 * Three next experiments without AI, built from the obstacle the team is on
 * and the number it watches: change one small thing for two days, watch it
 * happen once, and take the obstacle away for one piece of work. Each says
 * what the team expects, so it can start at once. Throws without an
 * obstacle or a target, as the schema refuses those (the button then asks
 * to fill the Kata in first).
 */
export function fallbackExperiments(
  obstacle: string,
  metric: string,
  target: string
): { step: string; expect: string }[] {
  if (!obstacle.trim()) throw new Error("Pick the obstacle you're on first.");
  if (!target.trim()) throw new Error("Set the target first.");
  const it = quoted(obstacle);
  const moves = metric.trim()
    ? `${quoted(metric, 60)} moves towards the target, even a little.`
    : "The number moves towards the target, even a little.";
  return [
    { step: `Try one small change to ${it} for two days.`, expect: moves },
    {
      step: `Watch ${it} happen once and write down every step.`,
      expect: "We find one step we can cut or shorten.",
    },
    {
      step: `Take ${it} out of the way for one piece of work only.`,
      expect: `That one piece of work shows whether ${it} is what holds us up.`,
    },
  ];
}

/** The next-experiment task's answer without AI. */
export const nextExperimentFallback = ({
  obstacle,
  metric,
  target,
}: NextExperimentInput): NextExperimentOutput => ({
  experiments: fallbackExperiments(obstacle, metric, target),
});

export const improveNextExperimentTask = lazyAiTask<NextExperimentInput, NextExperimentOutput>(
  { id: "improve.next_experiment", toolId: "improve", fallback: nextExperimentFallback },
  () => import("./improve").then((m) => m.improveNextExperimentTask)
);

/**
 * The Root Cause countermeasure input an A3 sends, trimmed until its request
 * (`{task, input}`) fits `budget` bytes: at its caps (20 whys of 1,000
 * characters, 20 causes of 300) it can pass the body budget. The causes go
 * first, from the least counted, then the whys from the last; the problem
 * and the root cause always stay. The input as it is when it already fits.
 */
export function fitCountermeasureInput(
  input: CountermeasureInput,
  budget: number = TOOL_AI_BODY_BUDGET
): CountermeasureInput {
  const size = (x: CountermeasureInput) =>
    jsonBytes({ task: "root-cause.countermeasure", input: x });
  if (size(input) <= budget) return input;
  let next: CountermeasureInput = { ...input, whys: [...input.whys], causes: [...input.causes] };
  while (next.causes.length > 0 && size(next) > budget) {
    next = { ...next, causes: next.causes.slice(0, -1) };
  }
  while (next.whys.length > 0 && size(next) > budget) {
    next = { ...next, whys: next.whys.slice(0, -1) };
  }
  return next;
}
