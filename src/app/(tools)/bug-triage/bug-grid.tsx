"use client";

import {
  BUG_PRIORITIES,
  BUG_SEVERITIES,
  type BugPriority,
  type BugSeverity,
} from "@/lib/stores/workspace-types";
import {
  CELL_ADVICE,
  PRIORITY_LABEL,
  SEVERITY_LABEL,
  mismatched,
  type GridCounts,
} from "@/lib/bug-triage/model";
import { cn } from "@/lib/utils";

export interface GridCell {
  severity: BugSeverity;
  priority: BugPriority;
}

const plural = (n: number) => (n === 1 ? "1 open bug" : `${n} open bugs`);

/**
 * The 4 × 4 grid: severity rows (how bad) by priority columns (how soon).
 * Each cell shows its open count as a number, never as a colour alone, and
 * the word "Check" where the two don't sit well together. Tapping a cell
 * lists its bugs. Short labels keep it inside a 375 px phone.
 */
export function BugGrid({
  counts,
  selected,
  onSelect,
}: {
  counts: GridCounts;
  selected: GridCell | null;
  onSelect: (cell: GridCell | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Open bugs by severity and priority"
      className="grid grid-cols-[minmax(0,5.5rem)_repeat(4,minmax(0,1fr))] gap-1"
    >
      <span aria-hidden="true" />
      {BUG_PRIORITIES.map((p) => (
        <span key={p} className="px-1 text-center text-xs font-medium text-sub" aria-hidden="true">
          {PRIORITY_LABEL[p]}
        </span>
      ))}
      {BUG_SEVERITIES.map((s) => (
        <GridRow key={s} severity={s} counts={counts} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  );
}

function GridRow({
  severity,
  counts,
  selected,
  onSelect,
}: {
  severity: BugSeverity;
  counts: GridCounts;
  selected: GridCell | null;
  onSelect: (cell: GridCell | null) => void;
}) {
  return (
    <>
      <span className="flex items-center text-xs font-medium text-sub" aria-hidden="true">
        {SEVERITY_LABEL[severity]}
      </span>
      {BUG_PRIORITIES.map((priority) => {
        const n = counts[severity][priority];
        const check = mismatched(severity, priority);
        const on = selected?.severity === severity && selected.priority === priority;
        return (
          <button
            key={priority}
            type="button"
            aria-pressed={on}
            aria-label={`${SEVERITY_LABEL[severity]} × ${PRIORITY_LABEL[priority]}: ${plural(n)}${
              check && n > 0 ? ", check" : ""
            }. ${CELL_ADVICE[severity][priority]}.`}
            data-cell={`${severity}:${priority}`}
            onClick={() => onSelect(on ? null : { severity, priority })}
            className={cn(
              "flex min-h-12 min-w-0 flex-col items-center justify-center rounded-md border px-1 py-1.5 text-center transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              on
                ? "border-accent bg-accent/15"
                : n > 0
                  ? "border-border bg-card hover:border-accent/40"
                  : "border-dashed border-border bg-transparent hover:border-accent/40"
            )}
          >
            <span
              className={cn(
                "font-mono text-base font-semibold tabular-nums",
                n > 0 ? "text-text" : "text-sub"
              )}
            >
              {n}
            </span>
            {check && n > 0 && <span className="text-xs font-medium text-warning">Check</span>}
          </button>
        );
      })}
    </>
  );
}
