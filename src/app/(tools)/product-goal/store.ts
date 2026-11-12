/**
 * Product Goal's own settings: the product vision the check list and Ask
 * Amr read. The goals themselves are workspace records (`productGoals`), so
 * agents and the pages that show the goal read the same ones.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";

/** The longest vision kept (the AI task's input cap). */
export const VISION_MAX = 2000;

export interface ProductGoalPrefs {
  vision: string;
}

export const useProductGoalPrefs = createPersistedStore<ProductGoalPrefs>("product-goal", {
  vision: "",
});

/** A vision read back from storage: a string, capped; anything else is "". */
export function normalizeVision(value: unknown): string {
  return typeof value === "string" ? value.slice(0, VISION_MAX) : "";
}
