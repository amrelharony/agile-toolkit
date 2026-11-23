"use client";

// Recharts lives here so the Retro page loads it only when an Emotional
// Seismograph board's chart mounts. Import this module through next/dynamic.
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { BAND_LABEL, SEISMOGRAPH_BANDS, type SeismographBand } from "@/lib/retro/seismograph";

export interface SeismographPoint {
  /** The sprint day. */
  x: number;
  /** The band's lane (Lows 1, Steady 2, Highs 3), nudged when cards stack. */
  y: number;
  band: SeismographBand;
  text: string;
  votes: number;
}

export interface MoodStripPoint {
  day: number;
  average: number;
}

const LANE_LABEL: Record<number, string> = { 1: "Lows", 2: "Steady", 3: "Highs" };

const { colors } = chartTheme;
const BAND_COLOR: Record<SeismographBand, string> = {
  highs: colors.green,
  steady: colors.blue,
  lows: colors.amber,
};
/** Each band's mark, so the bands differ by more than colour. */
const BAND_SHAPE = { highs: "triangle", steady: "square", lows: "diamond" } as const;

/** The day ticks: every day up to 15 days, every other day beyond. */
export function dayTicks(lastDay: number): number[] {
  const step = lastDay > 15 ? 2 : 1;
  const out: number[] = [];
  for (let d = 0; d <= lastDay; d += step) out.push(d);
  return out;
}

const axis = { fill: chartTheme.axisColor, fontSize: 12 };

/** The cards as dots: x the day, y the band's lane. */
export function SeismographChart({
  points,
  lastDay,
}: {
  points: readonly SeismographPoint[];
  lastDay: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 10, right: 8, left: 0, bottom: 0 }} accessibilityLayer={false}>
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="x"
          name="Day"
          domain={[0, Math.max(1, lastDay)]}
          ticks={dayTicks(lastDay)}
          allowDecimals={false}
          tick={axis}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
        />
        <YAxis
          type="number"
          dataKey="y"
          domain={[0.5, 3.5]}
          ticks={[1, 2, 3]}
          tickFormatter={(v: number) => LANE_LABEL[v] ?? ""}
          tick={axis}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          cursor={false}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as SeismographPoint | undefined;
            if (!p) return null;
            return (
              <div style={chartTheme.tooltipStyle} className="max-w-xs px-2 py-1">
                Day {p.x} · {BAND_LABEL[p.band]}: {p.text}
                {p.votes > 0 ? ` (${p.votes} ${p.votes === 1 ? "vote" : "votes"})` : ""}
              </div>
            );
          }}
        />
        {SEISMOGRAPH_BANDS.map((band) => (
          <Scatter
            key={band}
            name={BAND_LABEL[band]}
            data={points.filter((p) => p.band === band)}
            fill={BAND_COLOR[band]}
            shape={BAND_SHAPE[band]}
            isAnimationActive={false}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** The team's mood on the days it may show, on its own 1–5 scale. */
export function MoodStripChart({
  points,
  lastDay,
}: {
  points: readonly MoodStripPoint[];
  lastDay: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart
        data={[...points]}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
        <XAxis
          type="number"
          dataKey="day"
          domain={[0, Math.max(1, lastDay)]}
          ticks={dayTicks(lastDay)}
          allowDecimals={false}
          tick={axis}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
        />
        <YAxis
          type="number"
          domain={[1, 5]}
          ticks={[1, 3, 5]}
          tick={axis}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          contentStyle={chartTheme.tooltipStyle}
          labelFormatter={(day) => `Day ${day}`}
          formatter={(v) => [Number(v).toFixed(1), "Team mood"]}
        />
        <Line
          type="monotone"
          dataKey="average"
          name="Team mood"
          stroke={colors.purple}
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
