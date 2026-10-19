"use client";

// Recharts lives here so the NPS / CSAT page loads it only when the score
// trend chart mounts. Import this module through next/dynamic.
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";

interface ScoreTrendChartProps {
  data: { date: string; nps?: number; csat?: number }[];
  npsChangepoints: CausalAnnotationData[];
  csatChangepoints: CausalAnnotationData[];
}

export function ScoreTrendChart({ data, npsChangepoints, csatChangepoints }: ScoreTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
        <XAxis dataKey="date" stroke={chartTheme.axisColor} />
        {/* NPS (−100..+100) and CSAT (1–5) need their own scales: on one
            axis CSAT would sit flat along zero. */}
        <YAxis
          stroke={chartTheme.axisColor}
          domain={[-100, 100]}
          ticks={[-100, -50, 0, 50, 100]}
          label={{ value: "NPS", angle: -90, position: "insideLeft", fill: chartTheme.axisColor }}
        />
        <YAxis
          yAxisId="csat"
          orientation="right"
          stroke={chartTheme.axisColor}
          domain={[1, 5]}
          ticks={[1, 2, 3, 4, 5]}
          label={{ value: "CSAT", angle: 90, position: "insideRight", fill: chartTheme.axisColor }}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          formatter={(value, name) =>
            name === "CSAT" && typeof value === "number" ? value.toFixed(1) : value
          }
        />
        <Line type="monotone" dataKey="nps" stroke={chartTheme.colors.cyan} name="NPS" />
        <Line
          type="monotone"
          dataKey="csat"
          yAxisId="csat"
          stroke={chartTheme.colors.purple}
          name="CSAT"
        />
        {npsChangepoints.map((cp, i) => (
          <CausalLine key={`nps-cusum-${i}`} annotation={cp} />
        ))}
        {csatChangepoints.map((cp, i) => (
          <CausalLine key={`csat-cusum-${i}`} annotation={cp} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
