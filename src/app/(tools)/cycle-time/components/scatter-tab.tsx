"use client";

/**
 * Scatter view: per-item cycle time vs insertion order, with P50/P85/P95
 * reference lines and CUSUM regime-shift markers.
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";
import { ChartFigure } from "@/components/shared/chart-card";
import { scatterText } from "../chart-text";
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
  const text = useMemo(() => scatterText(scatterData, stats), [scatterData, stats]);
  return (
    <ChartFigure label="Cycle time scatter plot" summary={text.summary} table={text.table}>
      <CycleTimeScatterChart
        scatterData={scatterData}
        stats={stats}
        percentileMap={percentileMap}
        cusumAnnotations={cusumAnnotations}
      />
    </ChartFigure>
  );
}
