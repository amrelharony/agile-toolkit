"use client";

/**
 * WIP control chart: WIP over time with XmR UCL/LCL bands, CUSUM
 * regime-shift markers, Western-Electric out-of-control dots, and the WIP
 * limit if there is one. Shown inside Advanced analysis, and only once
 * the series is long enough for the limits to mean something.
 */

import { useId, useMemo } from "react";
import dynamic from "next/dynamic";
import { ChartFigure } from "@/components/shared/chart-card";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";
import type { WipLimits, WipSeriesPoint, WipSignal } from "../types";
import { wipChartText } from "../chart-text";

// Recharts loads with the chart, not the page. The fixed-height box below
// reserves the chart's space while the chunk loads.
const WipControlLineChart = dynamic(() => import("../charts").then((m) => m.WipControlLineChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

export function WipControlChart({
  wipSeries,
  wipLimits,
  wipLimit = null,
  cusumAnnotations,
  signals,
  unit,
}: {
  wipSeries: WipSeriesPoint[];
  wipLimits: WipLimits | null;
  wipLimit?: number | null;
  cusumAnnotations: CausalAnnotationData[];
  signals: WipSignal[];
  /** What a point is: ["day", "days"] or ["snapshot", "snapshots"]. */
  unit: readonly [string, string];
}) {
  const titleId = useId();
  const text = useMemo(
    () => wipChartText(wipSeries, signals, wipLimit, unit),
    [wipSeries, signals, wipLimit, unit]
  );
  return (
    <section className="space-y-2">
      <h3 id={titleId} className="text-sm font-semibold text-text">
        WIP control chart
        <span className="ml-1 text-xs font-normal text-sub">
          · XmR limits + CUSUM regime shifts
        </span>
      </h3>
      <ChartFigure
        labelledBy={titleId}
        summary={text.summary}
        table={text.table}
        plotClassName="-mx-2 h-60"
      >
        <WipControlLineChart
          wipSeries={wipSeries}
          wipLimits={wipLimits}
          wipLimit={wipLimit}
          cusumAnnotations={cusumAnnotations}
          signals={signals}
        />
      </ChartFigure>
    </section>
  );
}
