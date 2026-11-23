/**
 * Product Metrics' AI task, the def: suggest metrics for one framework (a
 * North Star with its inputs, HEART goals for a feature, or the five
 * AARRR stages) from what the product does and its Product Goal. The
 * person picks which to keep; each accepted one goes through the
 * workspace store with Undo. The fallback and the caps live in
 * `product-metrics.lite.ts`, which pages import. The prompt lives in
 * `product-metrics.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { AARRR_STAGES, HEART_CATEGORIES, METRIC_ROLES } from "@/lib/stores/workspace-types";
import {
  METRIC_FRAMEWORKS,
  SUGGESTED_DEFINITION_MAX,
  SUGGESTED_GOAL_MAX,
  SUGGESTED_MAX,
  SUGGESTED_NAME_MAX,
  SUGGESTED_UNIT_MAX,
} from "@/lib/product-metrics/templates";
import {
  SUGGEST_EXISTING_MAX,
  SUGGEST_EXISTING_NAME_MAX,
  SUGGEST_FEATURE_MAX,
  SUGGEST_GOAL_MAX,
  SUGGEST_PRODUCT_MAX,
  productMetricsSuggestFallback,
} from "./product-metrics.lite";

export {
  SUGGEST_EXISTING_MAX,
  SUGGEST_PRODUCT_MAX,
  productMetricsSuggestFallback,
} from "./product-metrics.lite";

const input = z.object({
  framework: z.enum(METRIC_FRAMEWORKS),
  product: z.string().trim().min(1).max(SUGGEST_PRODUCT_MAX),
  productGoal: z.string().trim().max(SUGGEST_GOAL_MAX).optional(),
  /** The feature a HEART set is for. */
  feature: z.string().trim().max(SUGGEST_FEATURE_MAX).optional(),
  /** The names the team already has, so suggestions don't repeat them. */
  existing: z
    .array(z.string().trim().min(1).max(SUGGEST_EXISTING_NAME_MAX))
    .max(SUGGEST_EXISTING_MAX),
});

const output = z.object({
  metrics: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(SUGGESTED_NAME_MAX),
        definition: z.string().trim().max(SUGGESTED_DEFINITION_MAX).optional(),
        unit: z.string().trim().max(SUGGESTED_UNIT_MAX).optional(),
        direction: z.enum(["increase", "decrease"]),
        role: z.enum(METRIC_ROLES).optional(),
        heartCategory: z.enum(HEART_CATEGORIES).optional(),
        goal: z.string().trim().max(SUGGESTED_GOAL_MAX).optional(),
        signal: z.string().trim().max(SUGGESTED_GOAL_MAX).optional(),
        aarrrStage: z.enum(AARRR_STAGES).optional(),
      })
    )
    .min(1)
    .max(SUGGESTED_MAX),
});

export type MetricsSuggestInput = z.infer<typeof input>;
export type MetricsSuggestOutput = z.infer<typeof output>;

export const productMetricsSuggestTask = defineAiTask({
  id: "product-metrics.suggest",
  toolId: "product-metrics",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: productMetricsSuggestFallback,
  sample: {
    framework: "north-star",
    product: "A retro tool for remote teams: run a retrospective, then follow up its actions.",
    productGoal: "Remote teams hold a retro every week and close what they agree.",
    existing: ["Retros per active team"],
  },
});
