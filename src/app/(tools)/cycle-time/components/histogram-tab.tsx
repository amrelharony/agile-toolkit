"use client";

/**
 * Histogram view: cycle-time distribution across fixed day-buckets, with
 * P50/P85/P95 reference lines drawn only when the percentile lands inside a
 * defined bucket, plus a legend.
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { ChartFigure } from "@/components/shared/chart-card";
import { histogramText, type QuotedPercentiles } from "../chart-text";
import type { HistogramDatum } from "../types";

// Recharts loads with the chart, not the page. The placeholder keeps the
// chart's 380px height while the chunk loads.
const CycleTimeHistogramChart = dynamic(
  () => import("../charts").then((m) => m.CycleTimeHistogramChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[380px] w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
    ),
  }
);

export function HistogramTab({
  histogramData,
  stats,
}: {
  histogramData: HistogramDatum[];
  stats: QuotedPercentiles;
}) {
  const text = useMemo(() => histogramText(histogramData, stats), [histogramData, stats]);
  return (
    <>
      <ChartFigure label="Cycle time histogram" summary={text.summary} table={text.table}>
        <CycleTimeHistogramChart histogramData={histogramData} stats={stats} />
      </ChartFigure>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-sub">
        <span className="flex items-center gap-1.5">
          <span className="w-5 border-t border-dashed border-accent" />
          P50 ({stats.median}d)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 border-t border-dashed border-warning" />
          P85 ({stats.p85}d)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 border-t border-dashed border-danger" />
          P95 ({stats.p95}d)
        </span>
      </div>
    </>
  );
}
