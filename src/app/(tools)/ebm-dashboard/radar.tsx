"use client";

/**
 * The four key value areas' progress as an angular radar (a diamond, so it
 * doesn't read as a round one), theme colours only, drawn on the pattern
 * of Psych Safety's radar. An area that isn't measured sits at the centre
 * and is labelled "not measured"; ChartFigure gives a summary and a table.
 */

import { ChartFigure } from "@/components/shared/chart-card";
import { EBM_VALUE_AREAS, type EbmValueArea } from "@/lib/stores/workspace-types";
import { AREA_LABEL, scoreText } from "@/lib/ebm/model";

const SIZE = 300;
const C = SIZE / 2;
const RADIUS = (SIZE / 2) * 0.62;

/** Where a 0–1 score sits on axis `i` of four: up, right, down, left. */
function at(i: number, score: number) {
  const angle = -Math.PI / 2 + (Math.PI / 2) * i;
  const r = RADIUS * Math.max(0, Math.min(1, score));
  return { x: C + Math.cos(angle) * r, y: C + Math.sin(angle) * r };
}

const ring = (level: number) =>
  EBM_VALUE_AREAS.map((_, i) => at(i, level))
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

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
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto h-auto w-full max-w-[300px]"
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
          const label = scores[a] === undefined ? `${AREA_LABEL[a]}: not measured` : AREA_LABEL[a];
          return (
            <g key={a}>
              <line x1={C} y1={C} x2={rim.x} y2={rim.y} stroke="var(--border)" />
              <text
                x={rim.x}
                y={rim.y}
                dy={i === 0 ? -8 : i === 2 ? 16 : -6}
                fontSize={11}
                fill="var(--sub)"
                textAnchor={i === 1 ? "end" : i === 3 ? "start" : "middle"}
                dx={i === 1 ? 4 : i === 3 ? -4 : 0}
                className="font-data"
              >
                {label}
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
