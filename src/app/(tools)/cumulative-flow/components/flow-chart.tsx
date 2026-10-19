"use client";

/**
 * The stacked cumulative-flow area chart (one Area per status column, Done at
 * the bottom), as a figure with a summary sentence and a "View as table"
 * toggle. Renders an empty-state when there are no snapshots yet. The WIP
 * limit is drawn on the WIP control chart, not here.
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { BarChart2 } from "lucide-react";
import { ChartFigure } from "@/components/shared/chart-card";
import { flowChartText } from "../chart-text";
import type { StatusColumn } from "../types";

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
  chartData,
  columns,
  labelledBy,
}: {
  chartData: Record<string, string | number>[];
  columns: StatusColumn[];
  /** The id of the card heading that names the chart. */
  labelledBy?: string;
}) {
  const text = useMemo(() => flowChartText(chartData, columns), [chartData, columns]);

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-sub gap-3">
        <BarChart2 className="w-12 h-12 opacity-20" />
        <p className="text-sm">Add date entries below to see the chart</p>
      </div>
    );
  }

  return (
    <ChartFigure
      labelledBy={labelledBy}
      label="Cumulative flow"
      summary={text.summary}
      table={text.table}
    >
      <CumulativeFlowAreaChart chartData={chartData} columns={columns} />
    </ChartFigure>
  );
}
