"use client";

import { useId, useMemo } from "react";
import { ChartFigure } from "@/components/shared/chart-card";
import type { DependencyEdge, DependencyNode, ISODateString } from "@/lib/stores/workspace-types";
import { DEPENDENCY_STATUS_LABEL, edgeStatus, isOverdue } from "@/lib/dependencies/edges";
import type { ChartTable } from "@/lib/charts/chart-text";
import { NO_VALUE, plural } from "@/lib/charts/chart-text";
import { cn } from "@/lib/utils";
import { dayLabel } from "./format";
import { flow, isBlocking, layoutGraph } from "./graph";

const NODE_W = 168;
const NODE_H = 48;
const COL_GAP = 72;
const ROW_GAP = 20;
const PAD = 14;
/** Characters that fit a node box at 12 px; longer names end in "…". */
const LABEL_FIT = 22;

type Tone = "open" | "at-risk" | "overdue" | "resolved";

/** Theme tokens only, so the graph follows dark, light and high contrast. */
const STROKE: Record<Tone, string> = {
  open: "stroke-accent",
  "at-risk": "stroke-warning",
  overdue: "stroke-danger",
  resolved: "stroke-sub opacity-40",
};
const FILL: Record<Tone, string> = {
  open: "fill-accent",
  "at-risk": "fill-warning",
  overdue: "fill-danger",
  resolved: "fill-sub opacity-40",
};

function toneOf(e: DependencyEdge, today: ISODateString): Tone {
  const s = edgeStatus(e);
  if (s === "resolved") return "resolved";
  if (isOverdue(e, today)) return "overdue";
  return s === "at-risk" ? "at-risk" : "open";
}

const fit = (s: string, n = LABEL_FIT) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The edges as rows, for the figure's "View as table". */
export function graphTable(
  nodes: readonly DependencyNode[],
  edges: readonly DependencyEdge[],
  today: ISODateString
): ChartTable {
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  return {
    caption: "Dependencies on the map",
    columns: ["From", "Type", "To", "Status", "Due"],
    rows: edges.map((e) => [
      label(e.from),
      e.kind,
      label(e.to),
      `${DEPENDENCY_STATUS_LABEL[edgeStatus(e)]}${isOverdue(e, today) ? ", overdue" : ""}`,
      e.due ? dayLabel(e.due) : NO_VALUE,
    ]),
  };
}

/**
 * The map as a layered picture: providers on the left, the work that waits
 * on them to the right, arrows coloured by status (red overdue, amber at
 * risk, faded when resolved) and dashed for "informs". The critical path's
 * nodes are outlined.
 *
 * The lists below stay the accessible way to read and edit the map; the
 * figure carries a one-sentence summary and the same edges as a table, and
 * the SVG itself is hidden from assistive tech (ChartFigure does that).
 */
export function DependencyGraph({
  nodes,
  edges,
  today,
  critical,
}: {
  nodes: readonly DependencyNode[];
  /** Clean edges only (both ends on the map). */
  edges: readonly DependencyEdge[];
  today: ISODateString;
  /** Node ids on the critical path. */
  critical: ReadonlySet<string>;
}) {
  const uid = useId().replace(/:/g, "");
  const layout = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  const cols = layout.columns.length;
  const rows = Math.max(1, ...layout.columns.map((c) => c.length));
  const width = PAD * 2 + cols * NODE_W + Math.max(0, cols - 1) * COL_GAP;
  // One spare row gap at the bottom for arrows that loop under the boxes.
  const height = PAD * 2 + rows * NODE_H + rows * ROW_GAP;
  const box = (id: string) => {
    const p = layout.position.get(id) ?? { col: 0, row: 0 };
    return { x: PAD + p.col * (NODE_W + COL_GAP), y: PAD + p.row * (NODE_H + ROW_GAP), col: p.col };
  };

  const blocking = edges.filter(isBlocking).length;
  const summary =
    edges.length === 0
      ? `${plural(nodes.length, "node")}, no dependencies drawn yet.`
      : `${plural(nodes.length, "node")} in ${plural(cols, "column")}, ${plural(blocking, "blocking link")}${
          edges.length > blocking ? ` and ${edges.length - blocking} informs` : ""
        }. Arrows run from the side that delivers to the side that waits.`;

  return (
    <ChartFigure
      label="Dependency graph"
      summary={summary}
      table={graphTable(nodes, edges, today)}
      plotClassName="overflow-x-auto"
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
        <defs>
          {(Object.keys(FILL) as Tone[]).map((tone) => (
            <marker
              key={tone}
              id={`${uid}-${tone}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className={FILL[tone]} />
            </marker>
          ))}
        </defs>

        {edges.map((e) => {
          const ends = isBlocking(e) ? flow(e) : { provider: e.from, consumer: e.to };
          const a = box(ends.provider);
          const b = box(ends.consumer);
          const tone = toneOf(e, today);
          let d: string;
          let mid: { x: number; y: number };
          if (a.col < b.col) {
            // Left to right: out of the provider's right side into the consumer's left.
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const c = Math.max(24, (x2 - x1) / 2);
            d = `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
            mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
          } else {
            // Same column or backwards (a cycle, or an "informs" edge): loop
            // below the boxes so the arrow doesn't run through them.
            const x1 = a.x + NODE_W / 2;
            const y1 = a.y + NODE_H;
            const x2 = b.x + NODE_W / 2;
            const y2 = b.y + NODE_H;
            const drop = Math.max(y1, y2) + ROW_GAP;
            d = `M${x1},${y1} C${x1},${drop} ${x2},${drop} ${x2},${y2}`;
            mid = { x: (x1 + x2) / 2, y: (y1 + y2 + 6 * drop) / 8 };
          }
          return (
            <g key={e.id}>
              <path
                d={d}
                fill="none"
                className={STROKE[tone]}
                strokeWidth={tone === "overdue" ? 2.5 : e.kind === "blocks" ? 2 : 1.5}
                strokeDasharray={e.kind === "informs" ? "5 4" : undefined}
                markerEnd={`url(#${uid}-${tone})`}
              />
              {tone === "overdue" && (
                <g transform={`translate(${mid.x},${mid.y})`}>
                  <circle r={8} className="fill-danger" />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={12}
                    fontWeight={700}
                    className="fill-bg"
                  >
                    !
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {nodes.map((n) => {
          const { x, y } = box(n.id);
          const onPath = critical.has(n.id);
          return (
            <g key={n.id} transform={`translate(${x},${y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                className={cn("fill-card", onPath ? "stroke-warning" : "stroke-border")}
                strokeWidth={onPath ? 2 : 1}
              />
              <text
                x={10}
                y={n.team ? 19 : NODE_H / 2}
                dominantBaseline="central"
                fontSize={12}
                fontWeight={600}
                className="fill-text"
              >
                {fit(n.label)}
              </text>
              {n.team && (
                <text x={10} y={35} dominantBaseline="central" fontSize={12} className="fill-sub">
                  {fit(n.team, 24)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-xs text-sub">
        Solid: blocks or needs · Dashed: informs · Red: overdue · Amber: at risk · Faded: resolved ·
        Outlined: on the critical path
      </p>
    </ChartFigure>
  );
}
