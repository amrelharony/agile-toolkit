"use client";

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
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
import { WSJF_SHORT, keptAfterClear, keptText } from "./wsjf-inputs";

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

/** Arrow keys move through a radio group's options and select as they go. */
const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/**
 * How long a value reached with the arrow keys waits for the next press
 * before it saves (a click, Space, Enter or leaving the picker saves it
 * at once).
 */
export const SETTLE_MS = 700;

/** A cell picked with the arrow keys, not saved yet. */
interface Staged {
  row: PrioritizationItem;
  key: WsjfKey;
  value: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Column-by-column scoring: one WSJF part across every feature at a time,
 * the way a PI planning room sizes relatively ("which is the smallest?
 * give it a 1"). Each pick saves that cell (the row, and the linked
 * backlog item, through the shell's save); a feature's score appears once
 * its four parts are set. Features stay in the order they were added, so
 * nothing moves while the column is being scored, and title-only features
 * are listed too.
 *
 * A radio group selects as the arrow keys move, so arrowing from 1 to 13
 * would save five times (five history entries, five backlog Undo toasts).
 * An arrow-key pick is staged instead (shown as picked) and saved once:
 * on a click, Space or Enter, when focus leaves that feature's picker, or
 * after SETTLE_MS without another press.
 */
export const ColumnScoring = forwardRef<
  HTMLHeadingElement,
  {
    rows: readonly RankedRow[];
    column: WsjfKey;
    /** Go to a column and take focus to its heading (Previous / Next). */
    onColumn: (key: WsjfKey) => void;
    /** Switch the column from its radio group: focus stays in the group. */
    onSwitch: (key: WsjfKey) => void;
    onDone: () => void;
    save: SaveCell;
    missingOne: readonly WsjfKey[];
  }
>(function ColumnScoring(
  { rows, column, onColumn, onSwitch, onDone, save, missingOne },
  headingRef
) {
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

  // Arrow-key picks waiting to save, by row id; `shown` re-renders them.
  const staged = useRef(new Map<string, Staged>());
  const [, shown] = useState(0);
  // Set by a key press just before the picker reports it, read by pick.
  const arrowed = useRef(false);
  // The last clear that left a value in place (keptAfterClear), shown by
  // its cell until the next save.
  const [keptNote, setKeptNote] = useState<{ rowId: string; key: WsjfKey; text: string } | null>(
    null
  );

  const commit = (row: PrioritizationItem, key: WsjfKey, value: number | undefined) => {
    const held = staged.current.get(row.id);
    if (held) {
      clearTimeout(held.timer);
      staged.current.delete(row.id);
      shown((n) => n + 1);
    }
    save(row, key, value);
    // Read the saved row back: its score is the registry's, from the store.
    const s = useWorkspaceStore.getState();
    const after = s.prioritizations?.find((x) => x.id === row.id);
    const done = after?.score !== undefined;
    // A business value the matrix places stays on the item (and the row
    // reads it through): say so, by the cell too, never "cleared".
    const kept =
      value === undefined && after ? keptAfterClear(after, key, s.backlogItems ?? []) : null;
    setKeptNote(kept ? { rowId: row.id, key, text: keptText(kept) } : null);
    announce(
      kept
        ? `${row.title}: ${keptText(kept)}`
        : value === undefined
          ? `${row.title}: ${WSJF_LABEL[key]} cleared.`
          : `${row.title}: ${WSJF_LABEL[key]} ${value}.${
              done ? ` WSJF ${WSJF.format(after!.score as number)}.` : ""
            }`
    );
  };
  const flush = (rowId: string) => {
    const held = staged.current.get(rowId);
    if (!held) return;
    // Arrowed away and back to the saved value: nothing to save.
    const now = toNumber(rows.find((r) => r.row.id === rowId)?.values[held.key]);
    if (now !== held.value) return commit(held.row, held.key, held.value);
    clearTimeout(held.timer);
    staged.current.delete(rowId);
    shown((n) => n + 1);
  };
  // The latest flush for the timers and the cleanups, which outlive a render.
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const pick = (r: RankedRow, value: number) => {
    const byArrow = arrowed.current;
    arrowed.current = false;
    if (!byArrow) return commit(r.row, column, value);
    const held = staged.current.get(r.row.id);
    if (held) clearTimeout(held.timer);
    staged.current.set(r.row.id, {
      row: r.row,
      key: column,
      value,
      timer: setTimeout(() => flushRef.current(r.row.id), SETTLE_MS),
    });
    shown((n) => n + 1);
  };

  // A staged cell belongs to its column: save it before the column changes,
  // and before the stepper closes.
  useEffect(() => {
    const pending = staged.current;
    return () => {
      for (const id of Array.from(pending.keys())) flushRef.current(id);
    };
  }, [column]);

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
          // Arrowing through the columns keeps focus in the group (the
          // heading takes it only from Previous / Next and the hint).
          onValueChange={onSwitch}
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
            const held = staged.current.get(r.row.id);
            const n = held?.key === column ? held.value : toNumber(r.values[column]);
            const custom = n !== undefined && !onScale(FIBONACCI_STEPS, n) ? n : null;
            return (
              // The handlers only watch the picker inside (which key picked,
              // whether focus left it); the radios are the controls.
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li
                key={r.row.id}
                className="py-3"
                onKeyDownCapture={(e) => {
                  arrowed.current = ARROWS.has(e.key);
                }}
                onPointerDownCapture={() => {
                  arrowed.current = false;
                }}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) flush(r.row.id);
                }}
              >
                <ScalePicker
                  label={r.row.title}
                  steps={FIBONACCI_STEPS}
                  value={n ?? null}
                  custom={custom}
                  size="sm"
                  // Seven steps (and a Custom) wrap as even rows of four on a phone.
                  optionsClassName="grid grid-cols-4 sm:inline-flex"
                  onValueChange={(v) => pick(r, v)}
                  onClear={() => commit(r.row, column, undefined)}
                  hint={standing(r)}
                />
                {keptNote?.rowId === r.row.id && keptNote.key === column && (
                  <p role="note" className="mt-1 text-xs text-sub">
                    {keptNote.text}
                  </p>
                )}
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
