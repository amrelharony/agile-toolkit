"use client";

// Recharts lives here so the NPS / CSAT page loads it only when the score
// trend chart mounts. Import this module through next/dynamic.
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import type { PeriodPoint } from "@/lib/nps/score";

const { colors } = chartTheme;

interface Row {
  label: string;
  nps: number | null;
  csat: number | null;
  npsN: number;
  csatN: number;
  enoughNps: boolean;
  enoughCsat: boolean;
}

/** A period's dot: filled with enough responses, hollow below the minimum. */
function dot(stroke: string, enough: (r: Row) => boolean) {
  function PeriodDot(props: { cx?: number; cy?: number; payload?: Row; index?: number }) {
    const { cx, cy, payload, index } = props;
    if (cx === undefined || cy === undefined || !payload) return <g key={index} />;
    const full = enough(payload);
    return (
      <circle
        key={index}
        cx={cx}
        cy={cy}
        r={full ? 3.5 : 4}
        stroke={stroke}
        strokeWidth={full ? 1 : 2}
        fill={full ? stroke : chartTheme.cardBackground}
      />
    );
  }
  return PeriodDot;
}

/**
 * NPS (−100..100, left) and CSAT as % satisfied (0..100, right) per week or
 * month, oldest first. A hollow dot marks a period below the minimum
 * responses; the table and summary say the same in words. A period with
 * no answers of a kind leaves a gap rather than a zero.
 */
export function ScoreTrendChart({ points }: { points: readonly PeriodPoint[] }) {
  const data: Row[] = points.map((p) => ({
    label: p.label,
    nps: p.nps.score,
    csat: p.csat.satisfiedPct,
    npsN: p.nps.n,
    csatN: p.csat.n,
    enoughNps: p.enoughNps,
    enoughCsat: p.enoughCsat,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      {/* ChartFigure hides the plot behind its summary and table, so the SVG
          mustn't be a tab stop. */}
      <LineChart
        data={data}
        margin={{ top: 8, right: 4, left: -16, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="nps"
          domain={[-100, 100]}
          ticks={[-100, -50, 0, 50, 100]}
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="csat"
          orientation="right"
          domain={[0, 100]}
          ticks={[0, 50, 100]}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <ReferenceLine yAxisId="nps" y={0} stroke={chartTheme.gridColor} />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(value, name, item) => {
            const row = item?.payload as Row | undefined;
            if (!row) return [String(value), String(name)];
            return name === "NPS"
              ? [`${value} (n ${row.npsN}${row.enoughNps ? "" : ", few"})`, "NPS"]
              : [`${value}% (n ${row.csatN}${row.enoughCsat ? "" : ", few"})`, "CSAT satisfied"];
          }}
        />
        <Legend wrapperStyle={chartTheme.legendStyle} />
        <Line
          yAxisId="nps"
          type="monotone"
          dataKey="nps"
          name="NPS"
          stroke={colors.cyan}
          strokeWidth={2}
          dot={dot(colors.cyan, (r) => r.enoughNps)}
          isAnimationActive={false}
        />
        <Line
          yAxisId="csat"
          type="monotone"
          dataKey="csat"
          name="CSAT % satisfied"
          stroke={colors.purple}
          strokeWidth={2}
          dot={dot(colors.purple, (r) => r.enoughCsat)}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
