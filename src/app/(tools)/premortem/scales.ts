import type { ScaleStep } from "@/components/shared/scale-picker";

/**
 * The 1–5 scales a cause is rated on, each value with what it means, so a
 * 4 means the same in every premortem and matches the Risk Register's
 * probability and impact when the cause becomes a risk.
 */
export const LIKELIHOOD_STEPS: readonly ScaleStep[] = [
  { value: 1, meaning: "Very unlikely: it would take bad luck" },
  { value: 2, meaning: "Unlikely, but it has happened before" },
  { value: 3, meaning: "Could go either way" },
  { value: 4, meaning: "Likely unless we act" },
  { value: 5, meaning: "Almost certain: it's happening already" },
];

export const IMPACT_STEPS: readonly ScaleStep[] = [
  { value: 1, meaning: "Barely noticed" },
  { value: 2, meaning: "A minor setback we recover from" },
  { value: 3, meaning: "Hurts the goal; a visible delay or cost" },
  { value: 4, meaning: "We miss the goal" },
  { value: 5, meaning: "Sinks the project" },
];

export const LIKELIHOOD_HINT = "1 very unlikely · 3 either way · 5 almost certain.";
export const IMPACT_HINT = "1 barely noticed · 3 hurts the goal · 5 sinks the project.";
