"use client";

import { useId } from "react";
import { SourceLink } from "@/components/handoff/source-link";
import { Field } from "@/components/ui/field";
import { colorVar } from "@/lib/roadmap/palette";
import { normalizeQuarter } from "@/lib/roadmap/quarters";
import { rollupLabel } from "@/lib/roadmap/rollup";
import { cn } from "@/lib/utils";
import {
  HORIZON_LABEL,
  NOW_CROWDED,
  horizonColumns,
  horizonMismatch,
  horizonOf,
} from "@/lib/roadmap/horizons";
import {
  EPIC_HORIZONS,
  type Epic,
  type EpicHorizon,
  type StrategyMap,
} from "@/lib/stores/workspace-types";
import { boardItems, epicName, whyLine, type BoardItem, type EpicView } from "./view";

const SELECT_CLASS =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-fine:md:h-9 pointer-fine:md:text-sm";

/** The note over a crowded Now column (no toast). */
export function crowdedNote(count: number): string {
  return `Now holds ${count} epics. Finishing some before starting more keeps the team focused.`;
}

/**
 * The Roadmap card's Now, Next, Later view: three columns (stacked on a
 * phone, side by side from md up) and the finished epics folded away under
 * Done. Each card can be moved by hand, or set back to follow its
 * quarters; a move never changes the quarters.
 */
export function HorizonsBoard({
  views,
  maps,
  now,
  onMove,
  highlightedId = null,
}: {
  views: readonly EpicView[];
  /** The strategy maps, for the "Why:" line of an epic sent from one. */
  maps: readonly StrategyMap[];
  now: Date;
  onMove: (epic: Epic, horizon: EpicHorizon | null) => void;
  /** The epic a `?epic=` link brought into view, marked until focus leaves it. */
  highlightedId?: string | null;
}) {
  const id = useId();
  const columns = horizonColumns(boardItems(views), now);
  return (
    <div className="space-y-3">
      {columns.now.length >= NOW_CROWDED && (
        <p className="rounded-md border border-warning/40 px-3 py-2 text-sm text-text">
          {crowdedNote(columns.now.length)}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {EPIC_HORIZONS.map((h) => (
          <section
            key={h}
            aria-labelledby={`${id}-${h}`}
            className="min-w-0 space-y-2 rounded-lg border border-border p-3"
          >
            <h3 id={`${id}-${h}`} className="text-sm font-semibold text-text">
              {HORIZON_LABEL[h]} ({columns[h].length})
            </h3>
            {columns[h].length === 0 ? (
              <p className="text-xs text-sub">Nothing here yet.</p>
            ) : (
              <ul className="space-y-2">
                {columns[h].map((item) => (
                  <li key={item.epic.id}>
                    <HorizonCard
                      item={item}
                      maps={maps}
                      now={now}
                      onMove={onMove}
                      highlighted={item.epic.id === highlightedId}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      {columns.done.length > 0 && (
        <details className="rounded-lg border border-border px-3 py-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-text">
            {HORIZON_LABEL.done} ({columns.done.length})
          </summary>
          <ul className="space-y-2 pb-2">
            {columns.done.map((item) => (
              <li key={item.epic.id}>
                <HorizonCard
                  item={item}
                  maps={maps}
                  now={now}
                  onMove={onMove}
                  highlighted={item.epic.id === highlightedId}
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** One epic on the board: colour, name, owner, progress, quarters, where its place comes from, why. */
function HorizonCard({
  item,
  maps,
  now,
  onMove,
  highlighted,
}: {
  item: BoardItem;
  maps: readonly StrategyMap[];
  now: Date;
  onMove: (epic: Epic, horizon: EpicHorizon | null) => void;
  highlighted: boolean;
}) {
  const headingId = useId();
  const { epic, view } = item;
  const name = epicName(epic);
  const place = horizonOf(item, now);
  const mismatch = horizonMismatch(item, now);
  const why = whyLine(epic, maps);
  const start = normalizeQuarter(epic.startQuarter);
  const end = normalizeQuarter(epic.endQuarter);
  const quarters =
    !start || !end ? "No valid quarters" : start === end ? start : `${start} → ${end}`;
  const fromText =
    place.from === "set"
      ? "Set by hand"
      : place.from === "done"
        ? "Done"
        : place.from === "none"
          ? "No valid quarters: Later until it has some"
          : "From its quarters";
  return (
    <article
      aria-labelledby={headingId}
      tabIndex={-1}
      data-epic-card={epic.id}
      className={cn(
        "space-y-1.5 rounded-md border bg-card p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        highlighted ? "border-accent ring-2 ring-ring" : "border-border"
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
          style={{ background: colorVar(view.color) }}
        />
        <div className="min-w-0 flex-1">
          <h4 id={headingId} className="break-words text-sm font-medium text-text">
            {name}
          </h4>
          <p className="text-xs text-sub">{epic.owner ? `Owner: ${epic.owner}` : "No owner"}</p>
        </div>
        <p className="shrink-0 font-data text-sm text-text">{view.rollup.pct}%</p>
      </div>
      <p className="text-xs text-sub">{rollupLabel(view.rollup)}</p>
      <p className="text-xs text-sub">
        <span className="font-data">{quarters}</span>
        {" · "}
        {fromText}
      </p>
      {mismatch && <p className="text-xs text-warning">{mismatch}</p>}
      {why && <p className="break-words text-xs text-sub">Why: {why}</p>}
      <SourceLink sourceRef={epic.sourceRef} />
      {!item.done && (
        <Field label="Horizon">
          {(p) => (
            <select
              {...p}
              aria-label={`Horizon for ${name}`}
              data-focus-key={`horizon:${epic.id}`}
              className={SELECT_CLASS}
              value={epic.horizon ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onMove(
                  epic,
                  (EPIC_HORIZONS as readonly string[]).includes(v) ? (v as EpicHorizon) : null
                );
              }}
            >
              {EPIC_HORIZONS.map((h) => (
                <option key={h} value={h}>
                  {HORIZON_LABEL[h]}
                </option>
              ))}
              <option value="">From its quarters</option>
            </select>
          )}
        </Field>
      )}
    </article>
  );
}
