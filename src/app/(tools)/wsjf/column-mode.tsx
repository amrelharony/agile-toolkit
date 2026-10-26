"use client";

import { forwardRef, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ScalePicker } from "@/components/shared/scale-picker";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { WSJF } from "@/lib/prioritization/methods";
import { onScale, toNumber } from "@/lib/prioritization/methods/fields";
import {
  FIBONACCI_STEPS,
  WSJF_KEYS,
  WSJF_LABEL,
  type WsjfKey,
} from "@/lib/prioritization/methods/wsjf";
import type { RankedRow } from "@/lib/prioritization/rank";
import { relativeHint } from "./verdict";
import { WSJF_SHORT } from "./wsjf-inputs";

const NO_ROWS: PrioritizationItem[] = [];

/** What each column asks, in the words of a relative sizing session. */
const QUESTION: Record<WsjfKey, string> = {
  businessValue: "Which feature is worth the least to users or the business? Give it a 1.",
  timeCriticality: "Which one loses the least by waiting? Give it a 1.",
  rrOe: "Which one removes the least risk or opens the fewest options? Give it a 1.",
  jobSize: "Which one is the smallest job? Give it a 1.",
};

/** Saves one part of one feature (undefined clears it). */
export type SaveCell = (row: PrioritizationItem, key: WsjfKey, value: number | undefined) => void;

/** How a feature stands after a pick, for the announcement and the line under its picker. */
function standing(r: RankedRow): string {
  if (r.result.score !== null) return `WSJF ${WSJF.format(r.result.score)}`;
  const set = WSJF_KEYS.filter((k) => r.values[k] !== undefined).length;
  return `${set} of 4 parts set`;
}

/**
 * Column-by-column scoring: one WSJF part across every feature at a time,
 * the way a PI planning room sizes relatively ("which is the smallest?
 * give it a 1"). Each pick saves that cell (the row, and the linked
 * backlog item, through the shell's save); a feature's score appears once
 * its four parts are set. Features stay in the order they were added, so
 * nothing moves while the column is being scored, and title-only features
 * are listed too.
 */
export const ColumnScoring = forwardRef<
  HTMLHeadingElement,
  {
    rows: readonly RankedRow[];
    column: WsjfKey;
    onColumn: (key: WsjfKey) => void;
    onDone: () => void;
    save: SaveCell;
    missingOne: readonly WsjfKey[];
  }
>(function ColumnScoring({ rows, column, onColumn, onDone, save, missingOne }, headingRef) {
  const announce = useAnnounce();
  const stored = useWorkspaceStore((s) => s.prioritizations) ?? NO_ROWS;
  // The order the features were added in (a save keeps a row's place in
  // the store), never the score order, so a pick never moves a row.
  const ordered = useMemo(() => {
    const at = new Map(stored.map((r, i) => [r.id, i]));
    return [...rows].sort((a, b) => (at.get(a.row.id) ?? 0) - (at.get(b.row.id) ?? 0));
  }, [rows, stored]);
  const index = WSJF_KEYS.indexOf(column);
  const prev = index > 0 ? WSJF_KEYS[index - 1] : null;
  const next = index < WSJF_KEYS.length - 1 ? WSJF_KEYS[index + 1] : null;
  const blank = ordered.filter((r) => r.values[column] === undefined).length;
  const input = WSJF.inputs.find((i) => i.key === column);

  const pick = (r: RankedRow, value: number | undefined) => {
    save(r.row, column, value);
    // Read the saved row back: its score is the registry's, from the store.
    const after = useWorkspaceStore.getState().prioritizations?.find((x) => x.id === r.row.id);
    const done = after?.score !== undefined;
    announce(
      value === undefined
        ? `${r.row.title}: ${WSJF_LABEL[column]} cleared.`
        : `${r.row.title}: ${WSJF_LABEL[column]} ${value}.${
            done ? ` WSJF ${WSJF.format(after!.score as number)}.` : ""
          }`
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <ToggleGroup
          label="Column to score"
          size="sm"
          className="flex-wrap"
          options={WSJF_KEYS.map((k) => ({
            value: k,
            label: WSJF_SHORT[k],
            description: WSJF_LABEL[k],
          }))}
          value={column}
          onValueChange={onColumn}
        />
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-medium text-text focus-visible:outline-none"
        >
          Column {index + 1} of 4: {WSJF_LABEL[column]}
        </h3>
        <p className="text-xs text-sub">
          {input?.hint} {QUESTION[column]}{" "}
          {blank > 0 ? `${blank} still blank.` : "Every feature has a value."}
        </p>
        {missingOne.includes(column) && (
          <p className="text-xs text-warning">{relativeHint([column])}</p>
        )}
      </div>

      <fieldset>
        <legend className="sr-only">{WSJF_LABEL[column]} for each feature</legend>
        <ol className="divide-y divide-border">
          {ordered.map((r) => {
            const n = toNumber(r.values[column]);
            const custom = n !== undefined && !onScale(FIBONACCI_STEPS, n) ? n : null;
            return (
              <li key={r.row.id} className="py-3">
                <ScalePicker
                  label={r.row.title}
                  steps={FIBONACCI_STEPS}
                  value={n ?? null}
                  custom={custom}
                  size="sm"
                  // Seven steps (and a Custom) wrap as even rows of four on a phone.
                  optionsClassName="grid grid-cols-4 sm:inline-flex"
                  onValueChange={(v) => pick(r, v)}
                  onClear={() => pick(r, undefined)}
                  hint={standing(r)}
                />
              </li>
            );
          })}
        </ol>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        {/* Short labels: a part's full name is too long for a phone's button. */}
        {prev && (
          <Button type="button" variant="outline" size="sm" onClick={() => onColumn(prev)}>
            <ChevronLeft aria-hidden="true" />
            Previous column
          </Button>
        )}
        {next ? (
          <Button type="button" variant="toolkit" size="sm" onClick={() => onColumn(next)}>
            Next column
            <ChevronRight aria-hidden="true" />
          </Button>
        ) : (
          <Button type="button" variant="toolkit" size="sm" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
});
