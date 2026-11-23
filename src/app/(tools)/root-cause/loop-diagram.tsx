"use client";

/**
 * The causal loop as a picture: the things on a circle in list order, an
 * arrow for each link with its sign (+ same way, − opposite ways) in a
 * badge and ‖ when it takes time, and each loop's label (R1, B1…) at its
 * centre. Arrows curve to their left, so A→B and B→A sit apart.
 *
 * Read-only: the lists beside it are where the loop is edited. The figure
 * has a one-sentence summary and the arrows as a table (From | To | Moves
 * | Takes time); the SVG itself is hidden from assistive tech (ChartFigure
 * does that). Theme tokens only, so it follows every theme.
 */

import { useId, useMemo } from "react";
import { ChartFigure } from "@/components/shared/chart-card";
import type { ChartTable } from "@/lib/charts/chart-text";
import type { RootCauseLoop, RootCauseLoopNode } from "@/lib/stores/workspace-types";
import {
  LOOP_NODE_BOX,
  LOOP_VIEWBOX,
  loopLayout,
  type LoopsFound,
  type LoopPoint,
} from "@/lib/root-cause/loops";
import { cn } from "@/lib/utils";

/** Characters a line in a thing's box holds at 12 px. */
const LINE_FIT = 16;

const fitLine = (s: string) => (s.length > LINE_FIT ? `${s.slice(0, LINE_FIT - 1).trimEnd()}…` : s);

/** A thing's words in at most two lines of LINE_FIT, the second ending in "…" when cut. */
export function boxLines(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= LINE_FIT) return [clean];
  const words = clean.split(" ");
  let first = "";
  let i = 0;
  for (; i < words.length; i++) {
    const next = first ? `${first} ${words[i]}` : words[i];
    if (next.length > LINE_FIT) break;
    first = next;
  }
  // One word longer than a line: cut it across the two.
  const rest = first ? words.slice(i).join(" ") : clean.slice(LINE_FIT);
  if (!first) first = clean.slice(0, LINE_FIT);
  return rest ? [first, fitLine(rest)] : [first];
}

/** "Same way (+)" or "Opposite ways (−)". */
export const MOVES_LABEL = { same: "Same way (+)", opposite: "Opposite ways (−)" } as const;

/** The arrows as rows, for the figure's "View as table". */
export function loopTable(loop: RootCauseLoop): ChartTable {
  const text = new Map(loop.nodes.map((n) => [n.id, n.text]));
  return {
    caption: "Arrows on the causal loop",
    columns: ["From", "To", "Moves", "Takes time"],
    rows: loop.links.map((l) => [
      text.get(l.from) ?? "?",
      text.get(l.to) ?? "?",
      MOVES_LABEL[l.polarity],
      l.delay ? "Yes" : "No",
    ]),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The figure's one sentence: what's on it and the loops it closes. */
export function loopSummary(loop: RootCauseLoop, found: LoopsFound): string {
  const head = `${plural(loop.nodes.length, "thing")} and ${plural(loop.links.length, "arrow")}`;
  if (found.loops.length === 0) return `${head}; no loop closes yet.`;
  const r = found.loops.filter((l) => l.kind === "reinforcing");
  const b = found.loops.filter((l) => l.kind === "balancing");
  const parts = [
    r.length > 0
      ? `${plural(r.length, "reinforcing loop")} (${r.map((l) => l.label).join(", ")})`
      : "",
    b.length > 0
      ? `${plural(b.length, "balancing loop")} (${b.map((l) => l.label).join(", ")})`
      : "",
  ].filter(Boolean);
  return `${head}: ${parts.join(" and ")}${found.truncated ? ", and maybe more" : ""}.`;
}

/** Where an arrow leaves (or meets) a box centred at `p`, heading towards `to`. */
function boxEdge(p: LoopPoint, to: { x: number; y: number }) {
  const dx = to.x - p.x;
  const dy = to.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const hw = LOOP_NODE_BOX.width / 2 + 3;
  const hh = LOOP_NODE_BOX.height / 2 + 3;
  const t = Math.min(
    ux === 0 ? Infinity : hw / Math.abs(ux),
    uy === 0 ? Infinity : hh / Math.abs(uy)
  );
  return { x: p.x + ux * t, y: p.y + uy * t };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** An arrow's path, its middle and where it bends: curving to the left of its way. */
export function arrowPath(a: LoopPoint, b: LoopPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.max(18, len * 0.18);
  const c = { x: (a.x + b.x) / 2 + (dy / len) * bend, y: (a.y + b.y) / 2 - (dx / len) * bend };
  const s = boxEdge(a, c);
  const e = boxEdge(b, c);
  const mid = { x: 0.25 * s.x + 0.5 * c.x + 0.25 * e.x, y: 0.25 * s.y + 0.5 * c.y + 0.25 * e.y };
  return {
    d: `M${r1(s.x)},${r1(s.y)} Q${r1(c.x)},${r1(c.y)} ${r1(e.x)},${r1(e.y)}`,
    mid,
  };
}

export function LoopDiagram({
  loop,
  found,
  busiest,
  rootText,
}: {
  loop: RootCauseLoop;
  found: LoopsFound;
  /** The thing in the most loops: outlined. */
  busiest: RootCauseLoopNode | null;
  /** The analysis's root cause, when it's a thing on the loop: marked. */
  rootText?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const points = useMemo(() => loopLayout(loop.nodes), [loop.nodes]);
  const at = new Map(points.map((p) => [p.id, p]));
  const { width, height } = LOOP_VIEWBOX;
  const bw = LOOP_NODE_BOX.width;
  const bh = LOOP_NODE_BOX.height;

  return (
    <ChartFigure
      label="Causal loop diagram"
      summary={loopSummary(loop, found)}
      table={loopTable(loop)}
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="mx-auto block h-auto w-full max-w-md">
        <defs>
          {(["same", "opposite"] as const).map((sign) => (
            <marker
              key={sign}
              id={`${uid}-${sign}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M0,0 L10,5 L0,10 z"
                className={sign === "same" ? "fill-accent" : "fill-warning"}
              />
            </marker>
          ))}
        </defs>

        {loop.links.map((l) => {
          const a = at.get(l.from);
          const b = at.get(l.to);
          if (!a || !b) return null;
          const { d, mid } = arrowPath(a, b);
          return (
            <g key={l.id}>
              <path
                d={d}
                fill="none"
                strokeWidth={1.75}
                className={l.polarity === "same" ? "stroke-accent" : "stroke-warning"}
                markerEnd={`url(#${uid}-${l.polarity})`}
              />
              <g transform={`translate(${r1(mid.x)},${r1(mid.y)})`}>
                <circle r={9} className="fill-card stroke-border" strokeWidth={1} />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={13}
                  fontWeight={700}
                  className="fill-text"
                >
                  {l.polarity === "same" ? "+" : "−"}
                </text>
                {l.delay && (
                  <text
                    x={14}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={13}
                    fontWeight={700}
                    className="fill-sub"
                  >
                    ‖
                  </text>
                )}
              </g>
            </g>
          );
        })}

        {found.loops.map((l, i) => {
          const ps = l.nodeIds.flatMap((id) => {
            const p = at.get(id);
            return p ? [p] : [];
          });
          if (ps.length === 0) return null;
          const x = ps.reduce((s, p) => s + p.x, 0) / ps.length;
          const y = ps.reduce((s, p) => s + p.y, 0) / ps.length + (i % 3) * 4;
          return (
            <text
              key={l.key}
              x={r1(x)}
              y={r1(y)}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={13}
              fontWeight={700}
              className="fill-sub"
            >
              {l.label}
            </text>
          );
        })}

        {loop.nodes.map((n) => {
          const p = at.get(n.id);
          if (!p) return null;
          const lines = boxLines(n.text);
          const isBusiest = busiest?.id === n.id;
          const isRoot = Boolean(rootText) && n.text.trim() === rootText;
          return (
            <g key={n.id} transform={`translate(${r1(p.x - bw / 2)},${r1(p.y - bh / 2)})`}>
              <rect
                width={bw}
                height={bh}
                rx={8}
                className={cn(
                  "fill-card",
                  isRoot ? "stroke-accent" : isBusiest ? "stroke-warning" : "stroke-border"
                )}
                strokeWidth={isRoot || isBusiest ? 2 : 1}
              />
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={bw / 2}
                  y={lines.length === 1 ? bh / 2 : bh / 2 + (i === 0 ? -8 : 8)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12}
                  className="fill-text"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-xs text-sub">
        + both move the same way · − they move opposite ways · ‖ takes time · R feeds itself · B
        holds itself back
        {busiest ? " · Outlined: in the most loops" : ""}
      </p>
    </ChartFigure>
  );
}
