"use client";

import { questionLabel, type QuestionResult } from "@/lib/psych-safety/instrument";

interface Point {
  x: number;
  y: number;
}

const SIZE = 300;
const C = SIZE / 2;
const RADIUS = (SIZE / 2) * 0.76;

/** Where a 1–5 score sits on axis `i` of `n` (1 at the centre, 5 at the rim). */
function at(i: number, n: number, score: number): Point {
  const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
  const r = RADIUS * Math.max(0, Math.min(1, (score - 1) / 4));
  return { x: C + Math.cos(angle) * r, y: C + Math.sin(angle) * r };
}

const polygon = (scores: number[]) =>
  scores
    .map((s, i) => at(i, scores.length, s))
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

/**
 * The seven statements' scores as a radar, theme colours only: the round
 * shown (solid) over the round it is compared with (dashed). Drawn only
 * when every statement shows; ChartFigure gives it a summary and a table.
 */
export function PsychSafetyRadar({
  cur,
  prev,
}: {
  cur: readonly QuestionResult[];
  prev?: readonly QuestionResult[] | null;
}) {
  const n = cur.length;
  const curScores = cur.map((q) => q.adjusted ?? 1);
  const prevScores =
    prev && prev.every((q) => q.adjusted !== null) ? prev.map((q) => q.adjusted as number) : null;
  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto h-auto w-full max-w-[300px]"
        aria-hidden="true"
      >
        {[1, 2, 3, 4, 5].map((lvl) => (
          <circle
            key={lvl}
            cx={C}
            cy={C}
            r={RADIUS * ((lvl - 1) / 4)}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}
        {cur.map((q, i) => {
          const rim = at(i, n, 5);
          return (
            <g key={q.id}>
              <line x1={C} y1={C} x2={rim.x} y2={rim.y} stroke="var(--border)" />
              <text
                x={rim.x}
                y={rim.y}
                dx={rim.x > C + 2 ? 6 : rim.x < C - 2 ? -6 : 0}
                dy={rim.y > C ? 12 : rim.y < C ? -4 : 4}
                fontSize={11}
                fill="var(--sub)"
                textAnchor={Math.abs(rim.x - C) < 4 ? "middle" : rim.x > C ? "start" : "end"}
                className="font-data"
              >
                {questionLabel(q.id)}
              </text>
            </g>
          );
        })}
        {prevScores && (
          <polygon
            points={polygon(prevScores)}
            fill="none"
            stroke="var(--sub)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
          />
        )}
        <polygon
          points={polygon(curScores)}
          fill="var(--accent)"
          fillOpacity={0.18}
          stroke="var(--accent)"
          strokeWidth={2}
        />
      </svg>
      <div
        className="flex flex-wrap items-center justify-center gap-4 text-xs text-sub"
        aria-hidden="true"
      >
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded bg-accent" />
          This round
        </span>
        {prevScores && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded border border-dashed border-sub" />
            Compared round
          </span>
        )}
      </div>
    </div>
  );
}
