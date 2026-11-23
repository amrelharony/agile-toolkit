/**
 * The EBM Dashboard's AI task, the def: suggest up to five measures for one
 * key value area, from what the product does, its Product Goal and the
 * strategic goal. The person picks which to keep; each accepted one
 * becomes a product metric in that area (with Undo). The fallback and the
 * caps live in `ebm-dashboard.lite.ts`, which pages import. The prompt
 * lives in `ebm-dashboard.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { EBM_VALUE_AREAS } from "@/lib/stores/workspace-types";
import {
  MEASURES_EXISTING_MAX,
  MEASURES_EXISTING_NAME_MAX,
  MEASURES_GOAL_MAX,
  MEASURES_MAX,
  MEASURES_PRODUCT_MAX,
  MEASURE_DEFINITION_MAX,
  MEASURE_NAME_MAX,
  MEASURE_UNIT_MAX,
  ebmMeasuresFallback,
} from "./ebm-dashboard.lite";

export { MEASURES_EXISTING_MAX, MEASURES_MAX, ebmMeasuresFallback } from "./ebm-dashboard.lite";

const input = z.object({
  area: z.enum(EBM_VALUE_AREAS),
  product: z.string().trim().max(MEASURES_PRODUCT_MAX),
  productGoal: z.string().trim().max(MEASURES_GOAL_MAX).optional(),
  strategicGoal: z.string().trim().max(MEASURES_GOAL_MAX).optional(),
  /** The measures the team already has, so suggestions don't repeat them. */
  existing: z
    .array(z.string().trim().min(1).max(MEASURES_EXISTING_NAME_MAX))
    .max(MEASURES_EXISTING_MAX),
});

const output = z.object({
  measures: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(MEASURE_NAME_MAX),
        definition: z.string().trim().max(MEASURE_DEFINITION_MAX).optional(),
        unit: z.string().trim().max(MEASURE_UNIT_MAX).optional(),
        direction: z.enum(["increase", "decrease"]),
      })
    )
    .min(1)
    .max(MEASURES_MAX),
});

export type EbmMeasuresInput = z.infer<typeof input>;
export type EbmMeasuresOutput = z.infer<typeof output>;

export const ebmMeasuresTask = defineAiTask({
  id: "ebm-dashboard.measures",
  toolId: "ebm-dashboard",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: ebmMeasuresFallback,
  sample: {
    area: "time-to-market",
    product: "A retro tool for remote teams: run a retrospective, then follow up its actions.",
    strategicGoal: "Every remote team we serve improves something each sprint.",
    existing: ["Median cycle time"],
  },
});
