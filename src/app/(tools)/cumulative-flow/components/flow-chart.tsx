"use client";

/**
 * The stacked cumulative-flow area chart (one Area per status column, Done at
 * the bottom). Renders an empty-state when there are no snapshots yet. The WIP
 * limit is drawn on the WIP control chart, not here.
 */

import dynamic from "next/dynamic";
import { BarChart2 } from "lucide-react";
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
}: {
  chartData: Record<string, string | number>[];
  columns: StatusColumn[];
}) {
  if (chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-sub gap-3">
        <BarChart2 className="w-12 h-12 opacity-20" />
        <p className="text-sm">Add date entries below to see the chart</p>
      </div>
    );
  }

  return <CumulativeFlowAreaChart chartData={chartData} columns={columns} />;
}
