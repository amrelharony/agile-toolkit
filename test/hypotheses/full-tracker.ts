import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { ENTITY_ROW_MAX_BYTES, type HypothesisTracker } from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";

const filler = (believe: string): HypothesisTracker => ({
  id: HYPOTHESIS_TRACKER_ID,
  hypotheses: [
    {
      id: "h0",
      believe,
      willDo: "",
      toLearn: "",
      successMetric: "",
      status: "running",
      raisedAt: "2026-10-01",
    },
  ],
});

/**
 * A Hypothesis Tracker ten bytes short of its one synced row
 * (ENTITY_ROW_MAX_BYTES): no new hypothesis fits beside its one.
 */
export const fullTracker = (): HypothesisTracker =>
  filler("x".repeat(ENTITY_ROW_MAX_BYTES - jsonBytes(filler("")) - 10));
