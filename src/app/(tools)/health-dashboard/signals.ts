"use client";

/**
 * Cross-tool signals: event streams from the workspace history that tend to
 * move together (a blocker spike around a velocity update, tech debt before
 * a mood dip, new risks after sprint-goal changes). Hints to look into, not
 * proof of cause, so the dashboard shows them in Advanced analysis only, and
 * only once a pair of streams crosses the confidence floor below.
 */

import { useMemo } from "react";
import { useHistoryStore } from "@/lib/history/history-store";
import { correlateEventStreams } from "@/lib/history/selectors";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation-list";

/** At least this many events within the lag, out of this many sampled pairs. */
const MIN_WITHIN_LAG = 3;
const MIN_PAIRS = 6;

const confidence = (within: number): CausalAnnotationData["confidence"] =>
  within >= 8 ? "strong" : within >= 5 ? "moderate" : "weak";

export function useCrossToolSignals(): CausalAnnotationData[] {
  // Subscribing re-runs the correlations when a new event lands.
  const events = useHistoryStore((s) => s.events);
  return useMemo<CausalAnnotationData[]>(() => {
    void events;
    const out: CausalAnnotationData[] = [];

    const velImp = correlateEventStreams(
      { toolId: "impediments", action: "impediment_raised" },
      { toolId: "velocity", action: "sprint_added" },
      3
    );
    if (velImp.withinLagCount >= MIN_WITHIN_LAG && velImp.pairs >= MIN_PAIRS) {
      out.push({
        x: 0,
        label: "Velocity dip aligned with blocker spike",
        detail: `Across ${velImp.pairs} sampled pairs, ${velImp.withinLagCount} blockers were raised within 3 days of a velocity update (mean lag ${velImp.meanLagDays.toFixed(1)} days). Inspect the Impediments and Velocity tools for the underlying sprints.`,
        link: { toolId: "impediments" },
        confidence: confidence(velImp.withinLagCount),
      });
    }

    const debtMood = correlateEventStreams(
      { toolId: "tech-debt", action: "item_added" },
      { toolId: "mood-tracker", action: "mood_logged" },
      14
    );
    if (debtMood.withinLagCount >= MIN_WITHIN_LAG && debtMood.pairs >= MIN_PAIRS) {
      out.push({
        x: 1,
        label: "Tech-debt spike correlates with team mood dip",
        detail: `${debtMood.withinLagCount} of ${debtMood.pairs} tech-debt entries fell within 14 days of a mood log (mean lag ${debtMood.meanLagDays.toFixed(1)} days). Long-term debt often comes before morale signals — worth exploring in the Tech Debt and Mood Tracker tools.`,
        link: { toolId: "tech-debt" },
        confidence: confidence(debtMood.withinLagCount),
      });
    }

    // "Missed sprint goal" is approximated by a sprint-goal save, the
    // closest event the history has.
    const goalRisk = correlateEventStreams(
      { toolId: "sprint-goal", action: "goal_saved" },
      { toolId: "risk-register", action: "risk_added" },
      14
    );
    if (goalRisk.withinLagCount >= MIN_WITHIN_LAG && goalRisk.pairs >= MIN_PAIRS) {
      out.push({
        x: 2,
        label: "Open risks rose after sprint-goal events",
        detail: `${goalRisk.withinLagCount} of ${goalRisk.pairs} new risks landed within 14 days of a sprint-goal save (mean lag ${goalRisk.meanLagDays.toFixed(1)} days). Inspect the Risk Register for context.`,
        link: { toolId: "risk-register" },
        confidence: confidence(goalRisk.withinLagCount),
      });
    }
    return out;
  }, [events]);
}
