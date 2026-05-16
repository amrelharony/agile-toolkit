"use client";

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { chartTheme } from "./chart-theme";
import type { ForecastPoint } from "@/lib/analytics/forecasting";

export interface ForecastBandSeries {
  historical: { x: number | string; y: number }[];
  forecast: ForecastPoint[];
  label: string;
}

interface ForecastBandChartProps {
  series: ForecastBandSeries;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}

// Drop NaN / Infinity / undefined points so Recharts doesn't render
// silently-broken paths (a single NaN point breaks Area connectNulls
// behaviour and produces a horizontal-line glitch through the rest of
// the chart).
function sanitizeY(y: number | undefined | null): number | undefined {
  return typeof y === "number" && Number.isFinite(y) ? y : undefined;
}

export function ForecastBandChart({ series, xLabel, yLabel, height = 320 }: ForecastBandChartProps) {
  const safeHistorical = (series.historical ?? []).filter(
    (p) => p != null && sanitizeY(p.y) !== undefined,
  );
  const safeForecast = (series.forecast ?? []).filter(
    (p) =>
      p != null &&
      sanitizeY(p.yHat) !== undefined &&
      sanitizeY(p.lower80) !== undefined &&
      sanitizeY(p.upper80) !== undefined &&
      sanitizeY(p.lower95) !== undefined &&
      sanitizeY(p.upper95) !== undefined,
  );

  const data: Array<{
    x: number | string;
    actual?: number;
    yHat?: number;
    band80Lower?: number;
    band80Upper?: number;
    band95Lower?: number;
    band95Upper?: number;
  }> = [];

  safeHistorical.forEach((p) => {
    data.push({ x: p.x, actual: p.y });
  });

  if (safeHistorical.length > 0 && safeForecast.length > 0) {
    const lastHist = safeHistorical[safeHistorical.length - 1];
    data[data.length - 1] = {
      ...data[data.length - 1],
      yHat: lastHist.y,
      band80Lower: lastHist.y,
      band80Upper: lastHist.y,
      band95Lower: lastHist.y,
      band95Upper: lastHist.y,
    };
  }

  safeForecast.forEach((f) => {
    data.push({
      x: f.x,
      yHat: f.yHat,
      band80Lower: Math.max(0, f.lower80),
      band80Upper: f.upper80,
      band95Lower: Math.max(0, f.lower95),
      band95Upper: f.upper95,
    });
  });

  const boundaryX =
    safeHistorical.length > 0 ? safeHistorical[safeHistorical.length - 1].x : undefined;

  // Empty-state guard. Without this, Recharts renders an empty axis
  // skeleton that gets confused with "loading" by users. Show explicit copy.
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-sub border border-dashed border-border rounded-md"
        style={{ height }}
        role="status"
      >
        No data to forecast yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 24, bottom: 24, left: 12 }}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
        <XAxis dataKey="x" stroke={chartTheme.axisColor} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -6, fill: chartTheme.axisColor } : undefined} />
        <YAxis stroke={chartTheme.axisColor} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: chartTheme.axisColor } : undefined} />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Legend wrapperStyle={chartTheme.legendStyle} />
        <Area
          dataKey="band95Upper"
          stroke="none"
          fill={chartTheme.colors.cyan}
          fillOpacity={0.08}
          name="95% band"
          connectNulls
        />
        <Area
          dataKey="band95Lower"
          stroke="none"
          fill={chartTheme.background}
          fillOpacity={1}
          legendType="none"
          connectNulls
        />
        <Area
          dataKey="band80Upper"
          stroke="none"
          fill={chartTheme.colors.cyan}
          fillOpacity={0.18}
          name="80% band"
          connectNulls
        />
        <Area
          dataKey="band80Lower"
          stroke="none"
          fill={chartTheme.background}
          fillOpacity={1}
          legendType="none"
          connectNulls
        />
        <Line
          dataKey="actual"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          dot={{ fill: chartTheme.colors.cyan, r: 3 }}
          name={series.label}
          connectNulls={false}
        />
        <Line
          dataKey="yHat"
          stroke={chartTheme.colors.cyan}
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
          name="Forecast"
          connectNulls
        />
        {boundaryX !== undefined && (
          <ReferenceLine
            x={boundaryX}
            stroke={chartTheme.colors.amber}
            strokeDasharray="2 2"
            label={{ value: "Now", fill: chartTheme.colors.amber, fontSize: 11 }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
