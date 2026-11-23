/**
 * Improve's AI task, the def (prompt in improve.server.ts; pages import
 * `improve.lite.ts`, which holds the fallback):
 *
 *   improve.next_experiment  a Kata's challenge, target, where it stands,
 *                            the obstacle it is on and its last experiments
 *                            → up to 3 next experiments, each with what the
 *                            team expects to happen
 *
 * An A3's countermeasure ideas reuse Root Cause's root-cause.countermeasure
 * (no task of its own). The fallback needs no model: three templates built
 * from the obstacle and the metric. The person picks one; nothing is
 * written on its own. No input carries a person's name.
 *
 * At its caps the input is 1,000 + 1,000 + 1,000 + 200 + 300 characters
 * and 10 past experiments of 4 × 300: 15,500 characters, about 47 KB in
 * 3-byte text, under TOOL_AI_BODY_BUDGET, so it needs no fitter (the golden
 * test checks the largest input fits).
 */

import { z } from "zod";
import { defineAiTask, type SchemaOf } from "../define-task";
import {
  EXPERIMENTS_MAX,
  EXPERIMENT_INPUT_MAX,
  EXPERIMENT_OUTPUT_MAX,
  nextExperimentFallback,
} from "./improve.lite";

export {
  EXPERIMENTS_MAX,
  EXPERIMENT_INPUT_MAX,
  EXPERIMENT_OUTPUT_MAX,
  fallbackExperiments,
  fitCountermeasureInput,
  nextExperimentFallback,
} from "./improve.lite";

const Line = (max: number) => z.string().trim().max(max);
const I = EXPERIMENT_INPUT_MAX;

const nextExperimentInput = z.object({
  challenge: Line(I.challenge),
  target: Line(I.target).min(1),
  current: Line(I.current),
  metric: Line(I.metric),
  obstacle: Line(I.obstacle).min(1),
  past: z
    .array(
      z.object({
        step: Line(I.pastField).min(1),
        expect: Line(I.pastField),
        result: Line(I.pastField),
        learned: Line(I.pastField),
      })
    )
    .max(I.past),
});

const nextExperimentOutput = z.object({
  experiments: z
    .array(
      z.object({
        step: Line(EXPERIMENT_OUTPUT_MAX.step).min(1),
        expect: Line(EXPERIMENT_OUTPUT_MAX.expect).min(1),
      })
    )
    .min(1)
    .max(EXPERIMENTS_MAX),
});

export type NextExperimentInput = SchemaOf<typeof nextExperimentInput>;
export type NextExperimentOutput = SchemaOf<typeof nextExperimentOutput>;

export const improveNextExperimentTask = defineAiTask({
  id: "improve.next_experiment",
  toolId: "improve",
  tier: "full",
  effort: "high",
  maxTokens: 4096,
  input: nextExperimentInput,
  output: nextExperimentOutput,
  fallback: nextExperimentFallback,
  sample: {
    challenge: "Every change is reviewed within a working day.",
    target: "Reviews start sooner: First-review wait (median) 8 h by 2026-12-04",
    current: "Reviews wait most of a day: First-review wait (median) 13 h on 2026-11-20",
    metric: "First-review wait (median)",
    obstacle: "Only two people feel able to review payment code.",
    past: [
      {
        step: "A review slot after standup every day.",
        expect: "The median wait drops below 15 h.",
        result: "It fell to 15 h, but payment changes still waited.",
        learned: "The slot helps; who can review matters more.",
      },
    ],
  },
});
