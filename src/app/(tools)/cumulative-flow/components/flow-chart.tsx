"use client";

/**
 * The stacked cumulative-flow area chart (one band per stage, Done at the
 * bottom), as a figure with a summary sentence and a "View as table"
 * toggle. The WIP limit is drawn on the WIP control chart, not here.
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { ChartFigure } from "@/components/shared/chart-card";
import type { FlowDay, FlowStage } from "@/lib/flow";
import { flowChartText } from "../chart-text";

// Recharts loads with the chart, not the page. The placeholder keeps the
// chart's 400px height while the chunk loads.
const CumulativeFlowAreaChart = dynamic(
  () => import("../charts").then((m) => m.CumulativeFlowAreaChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[400px] w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
    ),
  }
);

export function FlowChart({
  days,
  stages,
  labelledBy,
}: {
  days: readonly FlowDay[];
  stages: readonly FlowStage[];
  /** The id of the card heading that names the chart. */
  labelledBy?: string;
}) {
  const text = useMemo(() => flowChartText(days, stages), [days, stages]);
  return (
    <ChartFigure
      labelledBy={labelledBy}
      label="Cumulative flow"
      summary={text.summary}
      table={text.table}
    >
      <CumulativeFlowAreaChart days={days} stages={stages} />
    </ChartFigure>
  );
}
