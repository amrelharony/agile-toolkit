import { cusum } from "@/lib/analytics/changepoint";
import { enoughData } from "@/lib/analytics/min-sample";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation-list";

export interface ChangepointMarker {
  key: string;
  annotation: CausalAnnotationData;
  /** The sprint the shift starts at, and which way it goes (for the chart's summary). */
  sprint: string;
  direction: "up" | "down";
}

/**
 * CUSUM regime-shift markers for the velocity chart, anchored to the sprint's
 * name so they line up with bar centers.
 *
 * Pass the FINISHED sprints only, in chart order. CUSUM runs on their
 * completed points and each changepoint's index is looked up in the same
 * list. It used to be looked up in the full sprint list, so a planned
 * (unfinished) sprint before the finished ones moved the marker onto the
 * wrong sprint. Returns [] below MIN_SAMPLE.changePoint (8) finished
 * sprints: on fewer, one odd sprint reads as a regime shift.
 */
export function changepointMarkers(
  finishedSprints: { name: string; completed: number }[]
): ChangepointMarker[] {
  if (!enoughData(finishedSprints.length, "changePoint")) return [];
  return cusum(finishedSprints.map((s) => s.completed)).flatMap((cp) => {
    const sprint = finishedSprints[cp.index];
    if (!sprint) return [];
    return [
      {
        key: `cusum-${cp.index}-${cp.direction}`,
        sprint: sprint.name,
        direction: cp.direction,
        annotation: {
          x: sprint.name,
          label: `Regime shift ${cp.direction}`,
          detail: `CUSUM detected a ${cp.direction === "up" ? "sustained increase" : "sustained drop"} in completed velocity at ${sprint.name}.`,
          confidence: "moderate",
        },
      },
    ];
  });
}
