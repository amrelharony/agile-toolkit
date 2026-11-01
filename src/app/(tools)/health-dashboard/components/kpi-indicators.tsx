"use client";

/**
 * Small visual primitives for the dashboard: the traffic-light circle (an
 * image with its status as a name when labelled, so colour is never the
 * only cue) and a Mann-Kendall chip, shown in Advanced analysis once a
 * series is long enough for a trend test.
 */

import { useMemo } from "react";
import { mannKendall } from "@/lib/analytics/trend-test";
import type { TrafficStatus } from "@/lib/health-dashboard/settings";
import { cn } from "@/lib/utils";
import { STATUS_FILL, STATUS_LABEL } from "../status-config";

/**
 * The direction of a series by the Mann-Kendall test, and whether that is
 * good for this KPI. The arrow follows the data; good or bad follows the
 * KPI's direction (the old chip said "trending up" for a falling series
 * that happened to be good).
 */
export function MannKendallChip({
  label,
  series,
  higherIsBetter,
}: {
  label: string;
  series: readonly number[];
  higherIsBetter: boolean;
}) {
  const result = useMemo(() => mannKendall([...series]), [series]);
  if (!result.significant || result.trend === "none") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-sub">
        {label}: no confirmed trend (p = {result.pValue.toFixed(2)}
        {series.length < 10 ? "; the test confirms one from 10 points" : ""})
      </span>
    );
  }
  const up = result.trend === "up";
  const good = up === higherIsBetter;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs",
        good
          ? "border-success/40 bg-success/10 text-success"
          : "border-danger/40 bg-danger/10 text-danger"
      )}
      title="Mann-Kendall: a distribution-free test for a steady rise or fall"
    >
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>
      {label}: {up ? "rising" : "falling"}, {good ? "the better direction" : "the worse direction"}{" "}
      (p = {result.pValue.toFixed(2)})
    </span>
  );
}

const SIZE = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-12 w-12" } as const;

export function TrafficCircle({
  status,
  size = "md",
  labelled = false,
  emptyLabel = "No data",
}: {
  status: TrafficStatus | null;
  size?: keyof typeof SIZE;
  /** Name the circle by its status ("On track"); otherwise it's decoration. */
  labelled?: boolean;
  /** Its name without a light, as the KPI's card words it ("Not enough data"). */
  emptyLabel?: string;
}) {
  const a11y = labelled
    ? { role: "img" as const, "aria-label": status ? STATUS_LABEL[status] : emptyLabel }
    : { "aria-hidden": true as const };
  if (!status) {
    return (
      <div
        {...a11y}
        className={cn("shrink-0 rounded-full border-2 border-dashed border-border", SIZE[size])}
      />
    );
  }
  return <div {...a11y} className={cn("shrink-0 rounded-full", STATUS_FILL[status], SIZE[size])} />;
}
