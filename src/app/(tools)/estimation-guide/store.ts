/**
 * The Estimation Guide's store: the chosen scale and the team's description
 * and example for each value. Kept out of the page so the Team charter and
 * Planning Poker can read the baseline without the page's components.
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
  /**
   * Done workspace stories pinned as the reference for a value, keyed like
   * the entries ("Fibonacci:8" → story ids, see ./references). Added after
   * the first release: saved guides, cloud snapshots and share links from
   * before it have no such key, and the persist merge keeps this default.
   */
  referenceStoryIds: Record<string, string[]>;
}

export const initialState: EstimationGuideState = {
  selectedScale: "Fibonacci",
  descriptions: defaultScaleDescriptions(),
  examples: {},
  referenceStoryIds: {},
};

export const useEstimationGuideStore = createPersistedStore<EstimationGuideState>(
  "estimation-guide",
  initialState
);
