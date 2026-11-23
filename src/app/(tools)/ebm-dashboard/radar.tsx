"use client";

/**
 * The four key value areas' progress as an angular radar (a diamond, so it
 * doesn't read as a round one), theme colours only, drawn on the pattern
 * of Psych Safety's radar. An area that isn't measured sits at the centre
 * and is labelled "not measured"; ChartFigure gives a summary and a table.
 *
 * The side labels grow outwards from their spokes, a line per word group
 * with "not measured" on a line of its own, so Unrealized Value and
 * Ability to Innovate never run into each other or past the edge.
 */

import { ChartFigure } from "@/components/shared/chart-card";
import { EBM_VALUE_AREAS, type EbmValueArea } from "@/lib/stores/workspace-types";
import { AREA_LABEL, scoreText } from "@/lib/ebm/model";

/** The drawing's box and the diamond in it, in viewBox units. */
export const RADAR_BOX = { width: 360, height: 280, cx: 180, cy: 140, radius: 85 } as const;
/** The labels' font size and line height, in viewBox units. */
export const RADAR_FONT = 11;
const LINE = 13;
const GAP = 6;
const { width: WIDTH, height: HEIGHT, cx: CX, cy: CY, radius: RADIUS } = RADAR_BOX;

/** Where a 0–1 score sits on axis `i` of four: up, right, down, left. */
function at(i: number, score: number) {
  const angle = -Math.PI / 2 + (Math.PI / 2) * i;
  const r = RADIUS * Math.max(0, Math.min(1, score));
  return { x: CX + Math.cos(angle) * r, y: CY + Math.sin(angle) * r };
}

const ring = (level: number) =>
  EBM_VALUE_AREAS.map((_, i) => at(i, level))
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

export interface RadarLabel {
  x: number;
  /** The first line's baseline. */
  y: number;
  anchor: "start" | "middle" | "end";
  lines: string[];
}

/**
 * Axis `i`'s label: above the top spoke and below the bottom one on one
 * line, centred; beside the right spoke growing right and the left spoke
 * growing left, the area's name on two lines and "not measured" on a
 * third, centred on the spoke.
 */
export function radarLabel(i: number, area: EbmValueArea, measured: boolean): RadarLabel {
  const name = AREA_LABEL[area];
  if (i % 2 === 0) {
    return {
      x: CX,
      y: i === 0 ? CY - RADIUS - 8 : CY + RADIUS + 16,
      anchor: "middle",
      lines: [measured ? name : `${name}: not measured`],
    };
  }
  const words = name.split(" ");
  const last = words.pop() ?? name;
  const lines = [words.join(" "), last, ...(measured ? [] : ["not measured"])].filter(Boolean);
  const right = i === 1;
  return {
    x: right ? CX + RADIUS + GAP : CX - RADIUS - GAP,
    y: CY - ((lines.length - 1) * LINE) / 2 + 4,
    anchor: right ? "start" : "end",
    lines,
  };
}

export function EbmRadar({ scores }: { scores: Partial<Record<EbmValueArea, number>> }) {
  const measured = EBM_VALUE_AREAS.filter((a) => scores[a] !== undefined);
  const shape = EBM_VALUE_AREAS.map((a, i) => at(i, scores[a] ?? 0))
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
  const summary =
    measured.length === 0
      ? "No area is measured yet: add a measure with a reading and a target."
      : EBM_VALUE_AREAS.map((a) => `${AREA_LABEL[a]} ${scoreText(scores[a])}`).join(", ") +
        ". Area progress is a guide, not a grade.";
  return (
    <ChartFigure
      label="Area progress"
      summary={summary}
      table={{
        columns: ["Key value area", "Area progress"],
        rows: EBM_VALUE_AREAS.map((a) => [AREA_LABEL[a], scoreText(scores[a])]),
      }}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mx-auto h-auto w-full max-w-[360px]"
        aria-hidden="true"
      >
        {[0.25, 0.5, 0.75, 1].map((lvl) => (
          <polygon
            key={lvl}
            points={ring(lvl)}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}
        {EBM_VALUE_AREAS.map((a, i) => {
          const rim = at(i, 1);
          const label = radarLabel(i, a, scores[a] !== undefined);
          return (
            <g key={a}>
              <line x1={CX} y1={CY} x2={rim.x} y2={rim.y} stroke="var(--border)" />
              <text
                x={label.x}
                y={label.y}
                fontSize={RADAR_FONT}
                fill="var(--sub)"
                textAnchor={label.anchor}
                className="font-data"
                data-area={a}
              >
                {label.lines.map((line, k) => (
                  <tspan key={line} x={label.x} dy={k === 0 ? 0 : LINE}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
        {measured.length > 0 && (
          <polygon
            points={shape}
            fill="var(--accent)"
            fillOpacity={0.18}
            stroke="var(--accent)"
            strokeWidth={2}
            strokeLinejoin="miter"
          />
        )}
      </svg>
    </ChartFigure>
  );
}
