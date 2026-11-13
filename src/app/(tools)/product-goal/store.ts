/**
 * Product Goal's own settings: the product vision the check list and Ask
 * Amr read. The goals themselves are workspace records (`productGoals`), so
 * agents and the pages that show the goal read the same ones.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { PRODUCT_GOAL_STORE_NAME, VISION_MAX, normalizeVision } from "@/lib/product-goal/prefs";

// The vision's key, cap and read-back live in lib/product-goal/prefs, where
// Amr's verbs read them too.
export { VISION_MAX, normalizeVision };

export interface ProductGoalPrefs {
  vision: string;
}

export const useProductGoalPrefs = createPersistedStore<ProductGoalPrefs>(PRODUCT_GOAL_STORE_NAME, {
  vision: "",
});
