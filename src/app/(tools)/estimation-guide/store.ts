/**
 * The Estimation Guide's store: the chosen scale and the team's description
 * and example for each value. Kept out of the page so the Team charter can
 * read the baseline without the page's components.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { defaultScaleDescriptions } from "./entries";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface EstimationGuideState {
  selectedScale: string;
  /** Keyed per scale and value, e.g. "Fibonacci:8" (see ./entries). */
  descriptions: Record<string, string>;
  /** Keyed per scale and value, e.g. "Fibonacci:8" (see ./entries). */
  examples: Record<string, string>;
}

export const initialState: EstimationGuideState = {
  selectedScale: "Fibonacci",
  descriptions: defaultScaleDescriptions(),
  examples: {},
};

export const useEstimationGuideStore = createPersistedStore<EstimationGuideState>(
  "estimation-guide",
  initialState
);
