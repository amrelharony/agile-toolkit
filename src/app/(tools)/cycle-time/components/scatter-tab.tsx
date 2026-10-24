"use client";

/**
 * Scatter view: each finished item's cycle time at its finish date, with
 * P50/P85/P95 reference lines (once they may be quoted) and CUSUM
 * regime-shift markers (from Advanced analysis' sample floor).
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";
import { ChartFigure } from "@/components/shared/chart-card";
import { scatterText, type QuotedPercentiles } from "../chart-text";
import type { ScatterDatum } from "../types";

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
  cusumAnnotations,
}: {
  scatterData: ScatterDatum[];
  stats: QuotedPercentiles;
  cusumAnnotations: CausalAnnotationData[];
}) {
  const text = useMemo(() => scatterText(scatterData, stats), [scatterData, stats]);
  return (
    <ChartFigure label="Cycle time by completion date" summary={text.summary} table={text.table}>
      <CycleTimeScatterChart
        scatterData={scatterData}
        stats={stats}
        cusumAnnotations={cusumAnnotations}
      />
    </ChartFigure>
  );
}
