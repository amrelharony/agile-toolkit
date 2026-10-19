"use client";

/**
 * Scatter view: per-item cycle time vs insertion order, with P50/P85/P95
 * reference lines and CUSUM regime-shift markers.
 */

import dynamic from "next/dynamic";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";
import type { CycleStats, ScatterDatum } from "../types";

// Recharts loads with the chart, not the page. The placeholder keeps the
// chart's 380px height while the chunk loads.
const CycleTimeScatterChart = dynamic(
  () => import("../charts").then((m) => m.CycleTimeScatterChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[380px] w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
    ),
  }
);

export function ScatterTab({
  scatterData,
  stats,
  percentileMap,
  cusumAnnotations,
}: {
  scatterData: ScatterDatum[];
  stats: CycleStats;
  percentileMap: Record<number, number>;
  cusumAnnotations: CausalAnnotationData[];
}) {
  return (
    <CycleTimeScatterChart
      scatterData={scatterData}
      stats={stats}
      percentileMap={percentileMap}
      cusumAnnotations={cusumAnnotations}
    />
  );
}
