"use client";

// Recharts lives here so the Release Planner route loads it only when the
// chart mounts. forecast-view.tsx imports these via next/dynamic.
import { Fragment, useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  useChartWidth,
  useXAxisScale,
} from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";

/* -------------------------------------------------------------------------- */
/*  Tooltip                                                                    */
/* -------------------------------------------------------------------------- */

function HistogramTooltip({
  active,
  payload,
  label,
  total,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: number;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const count = payload[0].value;
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0";
  return (
    <div style={chartTheme.tooltipStyle} className="px-3 py-2 min-w-[140px]">
      <p className="mb-1 font-semibold text-text">
        {label} Sprint{label !== 1 ? "s" : ""}
      </p>
      <div className="text-xs space-y-0.5">
        <div className="flex justify-between gap-3">
          <span className="text-sub">Runs</span>
          <span className="font-data text-accent">{count.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-sub">Share of runs</span>
          <span className="font-data text-accent">{pct}%</span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Histogram                                                                  */
/* -------------------------------------------------------------------------- */

interface SimulationHistogramChartProps {
  histogram: { sprints: number; count: number }[];
  /** Total runs, for the tooltip's share. */
  total: number;
  /** Percentile lines; null (that share of runs never finishes) hides one. */
  p50: number | null;
  p85: number | null;
  p95: number | null;
  /** Sprints that fit before the target date; null hides the line. */
  target: number | null;
}

// Theme variables, so the lines read on the light theme and in PNG exports.
const { cyan, amber, red, green } = chartTheme.colors;

export interface Percentile {
  /** The bucket (sprints needed); null when that share of runs never finishes. */
  x: number | null;
  name: string;
  colour: string;
}

/** Percentile lines that land in the same bucket, drawn as one line with one label. */
export interface PercentileGroup {
  x: number;
  members: { name: string; colour: string }[];
}

/**
 * The percentiles grouped by bucket, in the order given: P50 and P85 in the
 * same bucket used to print their labels on top of each other, so P50 couldn't
 * be read. Each group gets one label ("P50·P85"). Pure, for tests.
 */
export function groupPercentiles(percentiles: readonly Percentile[]): PercentileGroup[] {
  const groups: PercentileGroup[] = [];
  for (const { x, name, colour } of percentiles) {
    if (x === null) continue;
    const group = groups.find((g) => g.x === x);
    if (group) group.members.push({ name, colour });
    else groups.push({ x, members: [{ name, colour }] });
  }
  return groups;
}

/** The text of a group's label: "P85", or "P50·P85" when lines share a bucket. */
export const percentileLabel = (group: PercentileGroup) =>
  group.members.map((m) => m.name).join("·");

// 12 px semibold Inter: about 7.5 px a character.
const LABEL_CHAR_PX = 7.5;
const LABEL_GAP = 4;

/**
 * Moves labels sideways just enough that none overlaps the next, keeping each
 * cluster of crowded labels centred on the lines it names and inside
 * [min, max]: on a phone, P85 and P95 in neighbouring buckets sit about 14 px
 * apart, less than a label's width. Returns each label's centre, in the order
 * given. Pure, for tests.
 */
export function spreadLabels(
  items: readonly { x: number; width: number }[],
  {
    min = -Infinity,
    max = Infinity,
    gap = LABEL_GAP,
  }: { min?: number; max?: number; gap?: number } = {}
): number[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a].x - items[b].x);
  // Clusters of touching labels, each laid out from `left` with `gap` between.
  type Cluster = { members: number[]; left: number; width: number };
  const widthOf = (members: number[]) =>
    members.reduce((w, i) => w + items[i].width, 0) + gap * (members.length - 1);
  // The left edge that centres the cluster on its lines on average.
  const idealLeft = (members: number[]) => {
    let offset = 0;
    let sum = 0;
    for (const i of members) {
      sum += items[i].x - (offset + items[i].width / 2);
      offset += items[i].width + gap;
    }
    const width = widthOf(members);
    return Math.min(Math.max(sum / members.length, min), max - width);
  };
  const clusters: Cluster[] = [];
  for (const i of order) {
    let cluster: Cluster = { members: [i], left: 0, width: items[i].width };
    cluster.left = idealLeft(cluster.members);
    // Merge back while this cluster overlaps the one before it.
    while (clusters.length > 0) {
      const prev = clusters[clusters.length - 1];
      if (prev.left + prev.width + gap <= cluster.left) break;
      clusters.pop();
      const members = [...prev.members, ...cluster.members];
      cluster = { members, left: idealLeft(members), width: widthOf(members) };
    }
    clusters.push(cluster);
  }
  const centres: number[] = items.map((item) => item.x);
  for (const { members, left } of clusters) {
    let offset = left;
    for (const i of members) {
      centres[i] = offset + items[i].width / 2;
      offset += items[i].width + gap;
    }
  }
  return centres;
}

/**
 * The percentile lines, their labels spread apart where neighbouring buckets
 * would print them over each other. Reads the chart's x scale, so it renders
 * inside the BarChart.
 */
function PercentileLines({ groups }: { groups: readonly PercentileGroup[] }) {
  const xOf = useXAxisScale();
  const chartWidth = useChartWidth();
  const shifts = useMemo(() => {
    if (!xOf || !chartWidth) return groups.map(() => 0);
    const items = groups.map((g) => ({
      // The bar's centre, where its reference line draws.
      x: xOf(g.x, { position: "middle" }) ?? 0,
      width: percentileLabel(g).length * LABEL_CHAR_PX,
    }));
    const centres = spreadLabels(items, { min: 0, max: chartWidth });
    return centres.map((c, i) => c - items[i].x);
  }, [xOf, chartWidth, groups]);
  return (
    <>
      {groups.map((group, i) => (
        <ReferenceLine
          key={percentileLabel(group)}
          x={group.x}
          // The highest percentile's colour: the line it drew on top before.
          stroke={group.members[group.members.length - 1].colour}
          strokeWidth={2}
          strokeDasharray="5 3"
          label={<PercentileLabel group={group} dx={shifts[i]} />}
        />
      ))}
    </>
  );
}

/**
 * A group's label above its line, each name in its line's colour, so a shared
 * bucket still says which percentiles it holds. Recharts passes the line's
 * viewBox (a zero-width box from the plot's top to its bottom).
 */
function PercentileLabel({
  group,
  dx = 0,
  viewBox,
}: {
  group: PercentileGroup;
  /** Sideways shift off the line, where a neighbour's label would overlap. */
  dx?: number;
  viewBox?: { x?: number; y?: number };
}) {
  if (viewBox?.x === undefined || viewBox.y === undefined) return null;
  return (
    <text
      x={viewBox.x + dx}
      // Recharts' "top" position: 5 px above the plot, text sitting on it.
      y={viewBox.y - 5}
      textAnchor="middle"
      fontSize={12}
      fontWeight={600}
      className="recharts-label"
    >
      {group.members.map((m, i) => (
        <Fragment key={m.name}>
          {i > 0 && <tspan fill={chartTheme.axisColor}>·</tspan>}
          <tspan fill={m.colour}>{m.name}</tspan>
        </Fragment>
      ))}
    </text>
  );
}

export function SimulationHistogramChart({
  histogram,
  total,
  p50,
  p85,
  p95,
  target,
}: SimulationHistogramChartProps) {
  const groups = useMemo(
    () =>
      groupPercentiles([
        { x: p50, name: "P50", colour: cyan },
        { x: p85, name: "P85", colour: amber },
        { x: p95, name: "P95", colour: red },
      ]),
    [p50, p85, p95]
  );
  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart
        data={histogram}
        // Room above the plot for the percentile labels (10 px cut them in
        // half) and below the ticks for the "Sprints needed" axis label.
        margin={{ top: 24, right: 20, left: 0, bottom: 20 }}
        barSize={histogram.length > 30 ? 4 : histogram.length > 15 ? 8 : 16}
        // ChartFigure hides the plot from assistive tech behind its summary
        // and table, so the SVG mustn't be a tab stop.
        accessibilityLayer={false}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
        <XAxis
          dataKey="sprints"
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          label={{
            value: "Sprints needed",
            position: "insideBottomRight",
            offset: -10,
            fill: chartTheme.axisColor,
            fontSize: 12,
          }}
        />
        <YAxis
          tick={{ fill: chartTheme.axisColor, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          label={{
            value: "Runs",
            angle: -90,
            position: "insideLeft",
            fill: chartTheme.axisColor,
            fontSize: 12,
            offset: 10,
          }}
        />
        <Tooltip content={<HistogramTooltip total={total} />} />

        <PercentileLines groups={groups} />

        {/* The sprints that fit before the target date, when one is set. */}
        {target !== null && (
          <ReferenceLine
            x={target}
            stroke={green}
            strokeWidth={2}
            label={{
              value: "Target",
              position: "insideTop",
              fill: green,
              fontSize: 12,
              fontWeight: 600,
            }}
          />
        )}

        <Bar dataKey="count" fill={cyan} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
