"use client";

/**
 * WIP control chart card: WIP over time with XmR UCL/LCL bands (suppressed
 * with a notice below the sample floor), CUSUM regime-shift markers, and
 * Western-Electric out-of-control dots.
 */

import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";
import type { WipLimits, WipSeriesPoint, WipSignal } from "../types";
import { MIN_XMR_SAMPLES } from "../constants";

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
  cusumAnnotations,
  signals,
}: {
  wipSeries: WipSeriesPoint[];
  wipLimits: WipLimits | null;
  cusumAnnotations: CausalAnnotationData[];
  signals: WipSignal[];
}) {
  return (
    <Card className="bg-surface border-border">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-display text-text flex-wrap">
          <Activity className="w-4 h-4 text-accent" />
          WIP control chart
          <span className="text-xs text-sub font-normal ml-1">
            · XmR limits + CUSUM regime shifts
          </span>
          {/* When the series is too short for statistically valid XmR
              limits (<8 samples), suppress the UCL/LCL bands and tell
              the user why — otherwise the chart shows misleading
              "control" lines that produce false alarms on every
              point. */}
          {!wipLimits && (
            <Badge
              variant="outline"
              className="text-xs font-normal border-warning/40 text-warning ml-auto"
            >
              Need {MIN_XMR_SAMPLES}+ data points for control limits
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="-mx-2" style={{ height: 240 }}>
          <WipControlLineChart
            wipSeries={wipSeries}
            wipLimits={wipLimits}
            cusumAnnotations={cusumAnnotations}
            signals={signals}
          />
        </div>
      </CardContent>
    </Card>
  );
}
