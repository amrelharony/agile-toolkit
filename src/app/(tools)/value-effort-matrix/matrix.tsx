"use client";

import { useMemo } from "react";
import {
  DragMatrix,
  type DragMatrixPane,
  type DragMatrixPlace,
  type PlaceHow,
} from "@/components/shared/drag-matrix";
import { cn } from "@/lib/utils";
import type { MatrixAt } from "@/lib/utils/matrix";
import {
  VE_EFFORT_AXIS,
  VE_HIGH_EFFORT_FROM,
  VE_HIGH_VALUE_FROM,
  VE_LABEL,
  VE_QUADRANTS,
  VE_VALUE_AXIS,
  type ValueEffortQuadrant,
} from "@/lib/prioritization/methods/value-effort";
import type { RankedRow } from "@/lib/prioritization/rank";
import { placeOf, positionText, quadrantOf } from "./model";

export type { PlaceHow };

/** A dot's fill: its quadrant, as theme tokens (never a hex). */
export const QUADRANT_DOT: Record<ValueEffortQuadrant, string> = {
  quick_wins: "bg-success",
  big_bets: "bg-accent",
  fill_ins: "bg-sub",
  time_wasters: "bg-danger",
};
const UNPLACED_DOT = "bg-card border-2 border-sub";

/** Panes, top row high value: Quick Wins (low effort), Big Bets (high effort). */
const PANES: readonly [DragMatrixPane, DragMatrixPane, DragMatrixPane, DragMatrixPane] = [
  { id: "quick_wins", label: VE_LABEL.quick_wins, className: "bg-success/5 text-success" },
  {
    id: "big_bets",
    label: VE_LABEL.big_bets,
    className: "bg-accent/10 text-accent",
    align: "right",
  },
  { id: "fill_ins", label: VE_LABEL.fill_ins, className: "bg-bg text-sub" },
  {
    id: "time_wasters",
    label: VE_LABEL.time_wasters,
    className: "bg-danger/5 text-danger",
    align: "right",
  },
];

/**
 * "Place in…": a spot in the middle of each quadrant, on the scales (effort
 * 3 or 8; value 13 high, 3 low). An explicit choice, never a default.
 */
const PLACES: readonly DragMatrixPlace[] = [
  { id: "quick_wins", label: VE_LABEL.quick_wins, at: { x: 3, y: 13 } },
  { id: "big_bets", label: VE_LABEL.big_bets, at: { x: 8, y: 13 } },
  { id: "fill_ins", label: VE_LABEL.fill_ins, at: { x: 3, y: 3 } },
  { id: "time_wasters", label: VE_LABEL.time_wasters, at: { x: 8, y: 3 } },
];

/** A row as a matrix item: effort across, value up. */
type MapItem = { id: string; title: string; quadrant: ValueEffortQuadrant | null } & {
  x: number | null;
  y: number | null;
};

const at = (p: { x: number | null; y: number | null }) => positionText({ value: p.y, effort: p.x });

/**
 * The Value × Effort 2×2 on the shared DragMatrix: drag a dot (or a chip
 * from "Not placed yet"), or focus a dot and use the arrow keys (Left and
 * Right change effort, Up and Down change value on its Fibonacci steps,
 * Shift moves 3); each chip also has a "Place in…" picker. Every move is
 * announced and saved once when it ends. The panes divide where the
 * quadrant changes (value 8, effort 6), so a drop lands where it counts.
 *
 * It is a control, not a picture: the lists under it are its text
 * alternative, so it is not wrapped in a ChartFigure (which would hide its
 * dots from screen readers behind the summary).
 */
export function ValueEffortMap({
  rows,
  selectedId,
  onSelect,
  onPlace,
}: {
  rows: readonly RankedRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlace: (id: string, at: MatrixAt, how: PlaceHow) => void;
}) {
  const items = useMemo<MapItem[]>(
    () =>
      rows.map((r) => {
        const p = placeOf(r);
        return {
          id: r.row.id,
          title: r.row.title,
          quadrant: quadrantOf(r),
          x: p.effort,
          y: p.value,
        };
      }),
    [rows]
  );
  return (
    <DragMatrix<MapItem>
      items={items}
      xAxis={VE_EFFORT_AXIS}
      yAxis={VE_VALUE_AXIS}
      yLabel="↑ Value"
      xLabel="Effort →"
      label="Value × Effort matrix"
      help={`Drag a dot, or focus it and use the arrow keys: Left and Right change effort, Up and Down change value (Shift moves 3). Value ${VE_HIGH_VALUE_FROM} or more and effort ${VE_HIGH_EFFORT_FROM} or more are high.`}
      panes={PANES}
      places={PLACES}
      positionText={at}
      itemName={(s) => s.title}
      chipLabel={(s) => `${s.title}: not placed yet. Drag onto the matrix, or pick a quadrant.`}
      dotClass={(s) => (s.quadrant ? QUADRANT_DOT[s.quadrant] : UNPLACED_DOT)}
      selectedId={selectedId}
      onSelect={onSelect}
      onPlace={onPlace}
      legend={
        <ul className="flex flex-wrap justify-center gap-3 text-xs" aria-label="Quadrant legend">
          {VE_QUADRANTS.map((q) => (
            <li key={q} className="flex items-center gap-1.5 text-sub">
              <span className={cn("h-3 w-3 rounded-full", QUADRANT_DOT[q])} aria-hidden="true" />
              {VE_LABEL[q]}
            </li>
          ))}
          <li className="flex items-center gap-1.5 text-sub">
            <span className={cn("h-3 w-3 rounded-full", UNPLACED_DOT)} aria-hidden="true" />
            Not placed yet
          </li>
        </ul>
      }
    />
  );
}
