"use client";

import { useMemo } from "react";
import {
  DragMatrix,
  type DragMatrixPane,
  type DragMatrixPlace,
  type PlaceHow,
} from "@/components/shared/drag-matrix";
import { cn } from "@/lib/utils";
import {
  QUADRANTS,
  QUADRANT_CENTRE,
  QUADRANT_LABEL,
  SENTIMENTS,
  SENTIMENT_LABEL,
  STAKEHOLDER_AXIS,
  gapText,
  positionText,
  sentimentGap,
  type Sentiment,
  type Stakeholder,
} from "./model";

export type { PlaceHow };

/** A dot's fill: the current sentiment, as theme tokens (never a hex). */
export const SENTIMENT_DOT: Record<Sentiment, string> = {
  champion: "bg-success",
  supporter: "bg-success/60",
  neutral: "bg-sub",
  skeptic: "bg-warning",
  blocker: "bg-danger",
};
const UNRATED_DOT = "bg-card border-2 border-sub";

const dotClass = (s: Pick<Stakeholder, "currentSentiment">) =>
  s.currentSentiment ? SENTIMENT_DOT[s.currentSentiment] : UNRATED_DOT;

/** Quadrant panes, top row high authority: Keep Satisfied, Manage Closely. */
const PANES: readonly [DragMatrixPane, DragMatrixPane, DragMatrixPane, DragMatrixPane] = [
  {
    id: "keepSatisfied",
    label: QUADRANT_LABEL.keepSatisfied,
    className: "bg-warning/5 text-warning",
  },
  {
    id: "manageClosely",
    label: QUADRANT_LABEL.manageClosely,
    className: "bg-accent/10 text-accent",
    align: "right",
  },
  { id: "monitor", label: QUADRANT_LABEL.monitor, className: "bg-bg text-sub" },
  {
    id: "keepInformed",
    label: QUADRANT_LABEL.keepInformed,
    className: "bg-success/5 text-success",
    align: "right",
  },
];

/** "Place in…": the middle of each quadrant (an explicit choice, never a default). */
const PLACES: readonly DragMatrixPlace[] = QUADRANTS.map((q) => ({
  id: q,
  label: QUADRANT_LABEL[q],
  at: { x: QUADRANT_CENTRE[q].interest, y: QUADRANT_CENTRE[q].authority },
}));

/** A stakeholder as a matrix item: interest across, authority up. */
type MapItem = Stakeholder & { x: number | null; y: number | null };

const at = (p: { x: number | null; y: number | null }) =>
  positionText({ interest: p.x, authority: p.y });

/**
 * The Interest × Authority 2×2, interactive (components/shared/drag-matrix):
 * drag a dot (or a chip from "Not placed yet") with the pointer, or focus a
 * dot and use the arrow keys (Left/Right interest, Up/Down authority, Shift
 * for 3 steps); each chip also has a "Place in…" picker. Every move is
 * announced, and saved once when it ends (pointer up, Enter, blur, or a
 * moment after the last key). Tapping a dot selects it for the detail panel.
 */
export function StakeholderMap({
  stakeholders,
  selectedId,
  onSelect,
  onPlace,
}: {
  stakeholders: readonly Stakeholder[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlace: (id: string, at: { interest: number; authority: number }, how: PlaceHow) => void;
}) {
  const items = useMemo<MapItem[]>(
    () => stakeholders.map((s) => ({ ...s, x: s.interest, y: s.authority })),
    [stakeholders]
  );
  return (
    <DragMatrix<MapItem>
      items={items}
      xAxis={STAKEHOLDER_AXIS}
      yAxis={STAKEHOLDER_AXIS}
      yLabel="↑ Authority"
      xLabel="Interest →"
      label="Interest × Authority map"
      help="Drag a dot, or focus it and use the arrow keys (Shift moves 3). Tap one to see their details."
      panes={PANES}
      places={PLACES}
      positionText={at}
      itemName={(s) => s.name}
      dotLabel={(s, position) => `${s.name}${s.role ? `, ${s.role}` : ""}: ${position}`}
      chipLabel={(s) => `${s.name}: not placed yet. Drag onto the map, or pick a quadrant.`}
      dotClass={dotClass}
      selectedId={selectedId}
      onSelect={onSelect}
      onPlace={(id, p, how) => onPlace(id, { interest: p.x, authority: p.y }, how)}
      legend={
        <ul className="flex flex-wrap justify-center gap-3 text-xs" aria-label="Sentiment legend">
          {SENTIMENTS.map((s) => (
            <li key={s} className="flex items-center gap-1.5 text-sub">
              <span className={cn("h-3 w-3 rounded-full", SENTIMENT_DOT[s])} aria-hidden="true" />
              {SENTIMENT_LABEL[s]}
            </li>
          ))}
          <li className="flex items-center gap-1.5 text-sub">
            <span className={cn("h-3 w-3 rounded-full", UNRATED_DOT)} aria-hidden="true" />
            Not set
          </li>
        </ul>
      }
    />
  );
}

/**
 * The selected stakeholder's details beside (or under) the map. Not a live
 * region: every move would re-read the whole card over the announcer's
 * "<name>: interest …", which says what changed.
 */
export function StakeholderDetail({
  stakeholder: s,
  lastContactText,
  nextTouchText,
}: {
  stakeholder: Stakeholder | null;
  lastContactText: string;
  nextTouchText: string;
}) {
  if (!s) {
    return (
      <section
        aria-label="Selected stakeholder"
        className="rounded-lg border border-dashed border-border p-3 text-xs text-sub"
      >
        Tap a dot (or press Enter on it) to see who it is.
      </section>
    );
  }
  const gap = gapText(sentimentGap(s));
  return (
    <section
      aria-label="Selected stakeholder"
      className="rounded-lg border border-border bg-card p-3 text-xs"
    >
      <div className="text-sm font-semibold text-text">{s.name}</div>
      {s.role && <div className="text-sub">{s.role}</div>}
      <div className="mt-1 text-sub">{positionText(s)}</div>
      <div className="mt-1 text-sub">
        {s.currentSentiment ? SENTIMENT_LABEL[s.currentSentiment] : "Sentiment not set"}
        {s.desiredSentiment && ` → ${SENTIMENT_LABEL[s.desiredSentiment]}`}
        {gap && ` (${gap})`}
      </div>
      <div className="mt-1 text-sub">
        {lastContactText} · {nextTouchText}
      </div>
    </section>
  );
}
