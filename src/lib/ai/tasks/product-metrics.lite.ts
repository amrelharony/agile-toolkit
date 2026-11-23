/**
 * Product Metrics' AI task, the lite half pages import (no zod; the def,
 * with its schemas, is `product-metrics.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import { metricTemplates, type MetricFramework } from "@/lib/product-metrics/templates";
import type { MetricsSuggestInput, MetricsSuggestOutput } from "./product-metrics";
export type { MetricsSuggestInput, MetricsSuggestOutput } from "./product-metrics";
export {
  METRIC_FRAMEWORKS,
  SUGGESTED_MAX,
  type MetricFramework,
  type SuggestedMetric,
} from "@/lib/product-metrics/templates";

/** The input's caps. */
export const SUGGEST_PRODUCT_MAX = 600;
export const SUGGEST_GOAL_MAX = 1000;
export const SUGGEST_FEATURE_MAX = 120;
export const SUGGEST_EXISTING_MAX = 60;
export const SUGGEST_EXISTING_NAME_MAX = 200;

const FRAMEWORKS: readonly MetricFramework[] = ["north-star", "heart", "aarrr"];

/**
 * The answer without AI: our own templates for the framework, leaving out
 * the names the team already has. Throws on input the def's schema
 * refuses (no framework, no product), so the button says what to fill in.
 */
export function productMetricsSuggestFallback(input: MetricsSuggestInput): MetricsSuggestOutput {
  if (!FRAMEWORKS.includes(input.framework)) {
    throw new Error("Pick North Star, HEART or the funnel first.");
  }
  if (typeof input.product !== "string" || !input.product.trim()) {
    throw new Error("Say what the product does first.");
  }
  return {
    metrics: metricTemplates({
      framework: input.framework,
      feature: input.feature,
      existing: (input.existing ?? []).slice(0, SUGGEST_EXISTING_MAX),
    }),
  };
}

export const productMetricsSuggestTask = lazyAiTask<MetricsSuggestInput, MetricsSuggestOutput>(
  {
    id: "product-metrics.suggest",
    toolId: "product-metrics",
    fallback: productMetricsSuggestFallback,
  },
  () => import("./product-metrics").then((m) => m.productMetricsSuggestTask)
);
