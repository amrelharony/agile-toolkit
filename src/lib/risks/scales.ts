/**
 * The 1–5 likelihood and impact scales, each value with what it means:
 * the Risk Register rates a risk's probability and impact on them and the
 * Premortem a cause's likelihood and impact, so a 4 means the same on
 * both pages (a cause becomes a risk through the "risk" hand-off) and in
 * any agent text that quotes a rating.
 *
 * Pure and server-safe: types only, so an agent action can import it.
 */

import type { RiskScale } from "@/lib/stores/workspace-types";

/**
 * One value on the scale with what it means: the ScalePicker's step
 * (components/shared/scale-picker.tsx), so the steps pass straight to the
 * picker.
 */
export interface RiskScaleStep {
  value: RiskScale;
  meaning: string;
}

export const LIKELIHOOD_STEPS: readonly RiskScaleStep[] = [
  { value: 1, meaning: "Very unlikely: it would take bad luck" },
  { value: 2, meaning: "Unlikely, but it has happened before" },
  { value: 3, meaning: "Could go either way" },
  { value: 4, meaning: "Likely unless we act" },
  { value: 5, meaning: "Almost certain: it's happening already" },
];

export const IMPACT_STEPS: readonly RiskScaleStep[] = [
  { value: 1, meaning: "Barely noticed" },
  { value: 2, meaning: "A minor setback we recover from" },
  { value: 3, meaning: "Hurts the goal; a visible delay or cost" },
  { value: 4, meaning: "We miss the goal" },
  { value: 5, meaning: "Sinks the project" },
];

export const LIKELIHOOD_HINT = "1 very unlikely · 3 either way · 5 almost certain.";
export const IMPACT_HINT = "1 barely noticed · 3 hurts the goal · 5 sinks the project.";
