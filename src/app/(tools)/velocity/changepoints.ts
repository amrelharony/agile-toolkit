import { cusum } from "@/lib/analytics/changepoint";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation-list";

export interface ChangepointMarker {
  key: string;
  annotation: CausalAnnotationData;
}

/**
 * CUSUM regime-shift markers for the velocity chart, anchored to the sprint's
 * name so they line up with bar centers.
 *
 * Pass the FINISHED sprints only, in chart order. CUSUM runs on their
 * completed points and each changepoint's index is looked up in the same
 * list. It used to be looked up in the full sprint list, so a planned
 * (unfinished) sprint before the finished ones moved the marker onto the
 * wrong sprint. Returns [] below 4 finished sprints.
 */
export function changepointMarkers(
  finishedSprints: { name: string; completed: number }[]
): ChangepointMarker[] {
  if (finishedSprints.length < 4) return [];
  return cusum(finishedSprints.map((s) => s.completed)).flatMap((cp) => {
    const sprint = finishedSprints[cp.index];
    if (!sprint) return [];
    return [
      {
        key: `cusum-${cp.index}-${cp.direction}`,
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
