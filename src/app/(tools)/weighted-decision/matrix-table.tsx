"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { BlurInput } from "@/components/shared/blur-fields";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ResortChip } from "@/components/shared/resort-chip";
import { useStableOrder } from "@/hooks/use-stable-order";
import type { WeightedCriterion, WeightedOption } from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { cn } from "@/lib/utils";
import {
  NOTE_MAX,
  OPTION_NAME_MAX,
  SCORE_MAX,
  SCORE_MIN,
  cellOf,
  formatTotal,
  scoreInputError,
  type MatrixResult,
  type OptionResult,
} from "@/lib/weighted/model";
import { FieldInPlace } from "./field-in-place";

export interface OptionDraft {
  name: string;
}

/**
 * Why an option can't be called `name` (trimmed), or null: the add form and
 * a rename in place share the rule (`taken`: the other options' names).
 */
export function optionNameError(name: string, taken: readonly string[]): string | null {
  if (!name) return "Name the option.";
  if (name.length > OPTION_NAME_MAX) return `Keep the name to ${OPTION_NAME_MAX} characters.`;
  if (taken.some((t) => t.trim().toLowerCase() === name.toLowerCase())) {
    return "This matrix already has an option with that name.";
  }
  return null;
}

/** An option needs a name the matrix doesn't already have. */
export function validateOption(
  d: OptionDraft,
  taken: readonly string[]
): Validation<{ name: string }, "name"> {
  const errors: FormErrors<"name"> = {};
  const name = d.name.trim();
  const why = optionNameError(name, taken);
  if (why) errors.name = why;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values: { name } };
}

/**
 * One cell, saved when it is left or on Enter (never per keystroke, so
 * typing "10" doesn't save a 1 first). Empty means not scored; a value
 * off the 1–10 scale isn't saved and the matrix says why. Escape puts the
 * stored score back. A stored score off the scale (an agent's) shows as
 * it is, marked, and doesn't count until it is fixed.
 */
function ScoreCell({
  option,
  criterion,
  errorId,
  rejected,
  onCommit,
  onReject,
}: {
  option: WeightedOption;
  criterion: WeightedCriterion;
  errorId: string;
  rejected: boolean;
  onCommit: (score: number | null) => void;
  onReject: (raw: string | null) => void;
}) {
  const cell = cellOf(option, criterion.id);
  const stored = cell.kind === "empty" ? "" : String(cell.value);
  const [draft, setDraft] = useState(stored);
  // A change from elsewhere (another tab, an agent, an Undo) replaces the draft.
  useEffect(() => setDraft(stored), [stored]);

  const commit = () => {
    const raw = draft.trim();
    if (raw === stored) {
      onReject(null);
      return;
    }
    if (scoreInputError(raw)) {
      onReject(raw);
      return;
    }
    onReject(null);
    onCommit(raw === "" ? null : Number(raw));
  };

  return (
    <div className="flex flex-col items-center gap-0.5">
      <Input
        inputMode="decimal"
        className={cn("h-8 w-16 text-center text-xs", cell.kind === "off" && "border-warning")}
        value={draft}
        placeholder="—"
        aria-label={`${criterion.name} score for ${option.name}`}
        aria-invalid={rejected || cell.kind === "off" ? true : undefined}
        aria-describedby={rejected ? errorId : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(stored);
            onReject(null);
          }
        }}
      />
      {cell.kind === "off" && <span className="text-xs text-warning">off scale</span>}
    </div>
  );
}

/** "★" on the leader (every tied option in a tie), for sighted and screen-reader users alike. */
function Star({ tied }: { tied: boolean }) {
  return (
    <span className="ml-1 text-xs text-success">
      <span aria-hidden="true">★</span>
      <span className="sr-only">{tied ? " (tied for the top)" : " (top option)"}</span>
    </span>
  );
}

/** An option's Total, or its partial sum and what is still missing. */
function TotalCell({ o }: { o: OptionResult }) {
  if (o.total !== null) return <span className="font-mono">{formatTotal(o.total)}</span>;
  return (
    <span className="block text-xs text-sub">
      <span className="font-mono">Partial: {formatTotal(o.partialTotal)}</span>
      <span className="block">
        {o.unscored.length === 1 ? "1 not scored" : `${o.unscored.length} not scored`}
      </span>
    </span>
  );
}

/**
 * The score matrix: one row per option, one column per criterion. Rows
 * keep their place while cells are scored (a "Re-sort" chip appears when
 * the order is out of date), the star goes only to a fully scored leader,
 * and a row's Total shows only once every weighted cell is scored. The
 * table scrolls sideways on a narrow screen with the option column kept
 * in view.
 */
export function MatrixTable({
  result,
  options,
  criteria,
  onScore,
  onRename,
  onNote,
  onDelete,
  onAdd,
}: {
  result: MatrixResult;
  options: readonly WeightedOption[];
  criteria: readonly WeightedCriterion[];
  onScore: (o: WeightedOption, criterion: WeightedCriterion, score: number | null) => void;
  onRename: (o: WeightedOption, name: string) => void;
  onNote: (o: WeightedOption, note: string) => void;
  onDelete: (o: WeightedOption) => void;
  onAdd: (name: string) => void;
}) {
  const errorId = useId();
  const [rejected, setRejected] = useState<{
    optionId: string;
    criterionId: string;
    raw: string;
  } | null>(null);
  const form = useItemForm<OptionDraft, { name: string }, "name">({
    initial: { name: "" },
    validate: (d) =>
      validateOption(
        d,
        options.map((o) => o.name)
      ),
    onSave: ({ name }) => onAdd(name),
  });

  // Rank order from the model; the rows on screen only follow it on Re-sort.
  const rank = new Map(result.options.map((o, i) => [o.id, i]));
  const { ordered, isStale, resort } = useStableOrder(
    result.options,
    (o) => o.id,
    (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
  );
  const rows = new Map(options.map((o) => [o.id, o]));
  const starred = new Set(result.tie ? result.tie.ids : result.leaderId ? [result.leaderId] : []);
  const boxRef = useRef<HTMLDivElement>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());

  // Focus moves to the next row's delete button on screen (or the one
  // before, or the add form's name field) as this row goes.
  const remove = (o: WeightedOption) => {
    const at = ordered.findIndex((r) => r.id === o.id);
    const next = ordered[at + 1] ?? ordered[at - 1];
    onDelete(o);
    const target = next
      ? deleteRefs.current.get(next.id)
      : boxRef.current?.querySelector<HTMLInputElement>("input");
    target?.focus();
  };
  const rejectedText = (() => {
    if (!rejected) return null;
    const o = rows.get(rejected.optionId);
    const c = criteria.find((x) => x.id === rejected.criterionId);
    return `Scores run from ${SCORE_MIN} to ${SCORE_MAX}. ${rejected.raw} for ${c?.name ?? "this criterion"} on ${o?.name ?? "this option"} wasn't saved.`;
  })();

  return (
    <div ref={boxRef} className="space-y-3">
      <ItemForm
        form={form}
        submitLabel="Add option"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      >
        <Field label="Option name" required error={form.errors.name}>
          {(props) => (
            <Input
              {...props}
              value={form.draft.name}
              maxLength={OPTION_NAME_MAX}
              placeholder="e.g. Vendor A"
              onChange={(e) => form.update({ name: e.target.value })}
            />
          )}
        </Field>
      </ItemForm>

      {ordered.length > 0 && criteria.length > 0 && (
        <>
          <p className="text-xs text-sub">
            Score each option from {SCORE_MIN} (poor) to {SCORE_MAX} (excellent) on every criterion.
            An empty cell isn&apos;t scored, not 0: a Total shows once every weighted cell is
            scored.
          </p>
          <ResortChip isStale={isStale} onResort={resort} />
          <div className="table-wrap-responsive rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-sub">
                  <th scope="col" className="sticky left-0 z-10 bg-card p-2">
                    Option
                  </th>
                  {criteria.map((c) => (
                    <th key={c.id} scope="col" className="p-2 text-center font-medium">
                      {c.name} <span className="font-mono">×{c.weight}</span>
                    </th>
                  ))}
                  <th scope="col" className="p-2 text-right">
                    Total
                  </th>
                  <th scope="col" className="w-10 p-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((r) => {
                  const o = rows.get(r.id);
                  if (!o) return null;
                  const star = starred.has(r.id);
                  return (
                    <tr key={r.id} className={cn("border-t border-border", star && "bg-success/5")}>
                      <th
                        scope="row"
                        className="sticky left-0 z-10 min-w-36 bg-card p-2 text-left font-normal"
                      >
                        <div className="flex items-center">
                          <FieldInPlace
                            label={`Name of the option ${o.name}`}
                            hideLabel
                            value={o.name}
                            maxLength={OPTION_NAME_MAX}
                            className="min-w-0 flex-1 gap-1"
                            inputClassName="h-8 min-w-0 text-sm"
                            // The add form's rules: not blank, not a name the matrix has.
                            check={(name) => {
                              const why = optionNameError(
                                name,
                                options.filter((x) => x.id !== o.id).map((x) => x.name)
                              );
                              return why ? `${why} It's still called “${o.name}”.` : null;
                            }}
                            onSave={(name) => onRename(o, name)}
                          />
                          {star && <Star tied={Boolean(result.tie)} />}
                        </div>
                        <BlurInput
                          aria-label={`Note on ${o.name}`}
                          value={o.note ?? ""}
                          maxLength={NOTE_MAX}
                          placeholder="Note"
                          className="mt-1 h-7 text-xs"
                          onCommit={(next) => onNote(o, next.trim())}
                        />
                      </th>
                      {criteria.map((c) => (
                        <td key={c.id} className="p-1 text-center">
                          <ScoreCell
                            option={o}
                            criterion={c}
                            errorId={errorId}
                            rejected={rejected?.optionId === o.id && rejected.criterionId === c.id}
                            onCommit={(score) => onScore(o, c, score)}
                            onReject={(raw) =>
                              setRejected(
                                raw === null
                                  ? (cur) =>
                                      cur?.optionId === o.id && cur.criterionId === c.id
                                        ? null
                                        : cur
                                  : { optionId: o.id, criterionId: c.id, raw }
                              )
                            }
                          />
                        </td>
                      ))}
                      <td className="p-2 text-right">
                        <TotalCell o={r} />
                      </td>
                      <td className="p-2">
                        <IconButton
                          ref={(el) => {
                            if (el) deleteRefs.current.set(o.id, el);
                            else deleteRefs.current.delete(o.id);
                          }}
                          label={`Delete the option ${o.name}`}
                          icon={<Trash2 className="h-4 w-4" />}
                          className="text-sub hover:text-danger"
                          onClick={() => remove(o)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rejectedText && (
            <p id={errorId} role="alert" className="text-xs text-danger">
              {rejectedText}
            </p>
          )}
        </>
      )}
    </div>
  );
}
