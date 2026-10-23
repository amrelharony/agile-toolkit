"use client";

// Recharts lives here so the Refinement route loads it only when the chart
// mounts. advanced.tsx imports these components via next/dynamic.
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { ControlLines } from "./analysis";

export interface PassRatePoint {
  name: string;
  passRate: number;
}

const { colors } = chartTheme;

/** Long story names would crowd the axis on a phone. */
const short = (name: string) => (name.length > 12 ? `${name.slice(0, 11)}…` : name);

/**
 * Pass rate per check, oldest first, against the 80% target, with the
 * p-chart's centre line and limits when there are enough checks for them.
 */
export function PassRateTrendChart({
  data,
  control,
}: {
  data: PassRatePoint[];
  /** p-chart limits; null when there are too few checks to draw them. */
  control: ControlLines | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <LineChart
        data={data}
        margin={{ top: 10, right: 16, left: -20, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          tickFormatter={short}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          // BUG-RD3-refinement-1: Recharts may call the formatter on a
          // ReferenceLine hover with no payload; optional-chain through.
          formatter={(v, _name, props) => [
            `${v}%`,
            (props as { payload?: { name?: string } }).payload?.name ?? "",
          ]}
        />
        <ReferenceLine
          y={80}
          stroke={colors.green}
          strokeDasharray="4 4"
          strokeOpacity={0.5}
          // Inside the plot: "right" put the label past the chart edge, cut off on a phone.
          label={{
            value: "80% target",
            fill: colors.green,
            fontSize: 12,
            position: "insideTopRight",
          }}
        />
        {control && (
          <>
            <ReferenceLine
              y={control.centerLinePct}
              stroke={colors.cyan}
              strokeDasharray="2 4"
              strokeOpacity={0.55}
              label={{ value: "X̄", fill: colors.cyan, fontSize: 12, position: "right" }}
              ifOverflow="extendDomain"
            />
            <ReferenceLine
              y={control.uclPct}
              stroke={colors.green}
              strokeDasharray="2 4"
              strokeOpacity={0.55}
              label={{ value: "UCL", fill: colors.green, fontSize: 12, position: "right" }}
              ifOverflow="extendDomain"
            />
            <ReferenceLine
              y={control.lclPct}
              stroke={colors.red}
              strokeDasharray="2 4"
              strokeOpacity={0.55}
              label={{ value: "LCL", fill: colors.red, fontSize: 12, position: "right" }}
              ifOverflow="extendDomain"
            />
          </>
        )}
        <Line
          type="monotone"
          dataKey="passRate"
          name="Pass rate"
          stroke={colors.cyan}
          strokeWidth={2}
          dot={{ fill: colors.cyan, r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
