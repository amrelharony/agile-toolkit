"use client";

/**
 * WIP control chart card: WIP over time with XmR UCL/LCL bands (suppressed
 * with a notice below the sample floor), CUSUM regime-shift markers, and
 * Western-Electric out-of-control dots.
 */

import {
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import type { WipLimits, WipSeriesPoint, WipSignal } from "../types";
import { MIN_XMR_SAMPLES } from "../constants";

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
              className="text-[10px] font-normal border-warning/40 text-warning ml-auto"
            >
              Need {MIN_XMR_SAMPLES}+ data points for control limits
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="-mx-2" style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={wipSeries} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--sub)" }}
              />
              {wipLimits && (
                <>
                  <ReferenceLine
                    y={wipLimits.centerLine}
                    stroke="var(--sub)"
                    strokeDasharray="2 4"
                    label={{
                      value: `X̄ ${wipLimits.centerLine.toFixed(1)}`,
                      fill: "var(--sub)",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <ReferenceLine
                    y={wipLimits.ucl}
                    stroke="#ef4444"
                    strokeDasharray="4 2"
                    label={{
                      value: `UCL ${wipLimits.ucl.toFixed(1)}`,
                      fill: "#ef4444",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <ReferenceLine
                    y={wipLimits.lcl}
                    stroke="#ef4444"
                    strokeDasharray="4 2"
                    label={{
                      value: `LCL ${wipLimits.lcl.toFixed(1)}`,
                      fill: "#ef4444",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                </>
              )}
              {cusumAnnotations.map((a, i) => (
                <CausalLine key={i} annotation={a} />
              ))}
              {/* Western Electric out-of-control markers — small red
                  dots at the offending sample. Hover hint via the SVG
                  title shows which rule fired. */}
              {signals.map((sig) => {
                const point = wipSeries[sig.index];
                if (!point) return null;
                return (
                  <ReferenceDot
                    key={`we-${sig.index}-${sig.rule}`}
                    x={point.date}
                    y={point.value}
                    r={4}
                    fill="var(--destructive)"
                    stroke="var(--destructive)"
                    ifOverflow="extendDomain"
                  >
                    <title>{`${sig.rule}: ${sig.description}`}</title>
                  </ReferenceDot>
                );
              })}
              <Line
                type="monotone"
                dataKey="value"
                stroke="#00f0ff"
                strokeWidth={2}
                dot={{ r: 3, fill: "#00f0ff" }}
                activeDot={{ r: 5 }}
                name="WIP"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
