"use client";

import { Pencil, Trash2 } from "lucide-react";
import { BacklogRowLink } from "@/components/prioritization/backlog-link";
import { ScaleValue } from "@/components/shared/scale-picker";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { VE_EFFORT_STEPS, VE_VALUE_STEPS } from "@/lib/prioritization/methods/value-effort";
import type { RankedRow } from "@/lib/prioritization/rank";
import { offScaleNote, placeOf, ratioText } from "./model";

/**
 * One item in its quadrant's list: title and backlog link, value and
 * effort as it shows them (a linked row's from its backlog item; "custom"
 * when off the scale), value ÷ effort, Edit and Delete. `legacyNote` says
 * when the value was read from the old 1–10 value (legacyValueNote);
 * `editRef` takes the Edit button, where focus comes back after the row's
 * editor closes.
 */
export function VeRow({
  ranked,
  selected,
  onEdit,
  onRemove,
  editRef,
  legacyNote,
}: {
  ranked: RankedRow;
  selected: boolean;
  onEdit: () => void;
  onRemove: () => void;
  editRef?: (el: HTMLElement | null) => void;
  legacyNote?: string | null;
}) {
  const { row } = ranked;
  const at = placeOf(ranked);
  const ratio = ratioText(ranked);
  const note = offScaleNote(ranked);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md",
        selected && "bg-accent/5"
      )}
    >
      <span className="inline-flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-2 text-sm text-text">
        <span className="break-words">{row.title}</span>
        <BacklogRowLink row={row} />
      </span>
      <dl className="flex items-center gap-3 font-mono text-xs text-sub">
        <div className="flex gap-1">
          <dt className="font-sans">Value</dt>
          <dd className="text-text">
            {at.value === null ? "—" : <ScaleValue steps={VE_VALUE_STEPS} value={at.value} />}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="font-sans">Effort</dt>
          <dd className="text-text">
            {ranked.values.effort === undefined ? (
              "—"
            ) : (
              <ScaleValue steps={VE_EFFORT_STEPS} value={ranked.values.effort} />
            )}
          </dd>
        </div>
      </dl>
      <span className="w-20 shrink-0 text-right font-mono text-sm text-text">
        {ratio === null ? (
          <span className="font-sans text-xs text-sub">Not placed</span>
        ) : (
          <>
            <span className="sr-only">Value ÷ effort </span>
            {ratio}
          </>
        )}
      </span>
      <span className="flex shrink-0 items-center">
        <IconButton
          ref={editRef}
          label={`Edit ${row.title}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Delete ${row.title}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
      {legacyNote && <p className="basis-full text-xs text-sub">{legacyNote}</p>}
      {note && <p className="basis-full text-xs text-warning">{note}</p>}
    </div>
  );
}
