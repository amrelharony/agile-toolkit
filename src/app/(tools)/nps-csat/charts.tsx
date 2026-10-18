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
        <YAxis stroke={chartTheme.axisColor} />
        <Tooltip contentStyle={chartTheme.tooltipStyle} />
        <Line type="monotone" dataKey="nps" stroke={chartTheme.colors.cyan} name="NPS" />
        <Line type="monotone" dataKey="csat" stroke={chartTheme.colors.purple} name="CSAT" />
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
