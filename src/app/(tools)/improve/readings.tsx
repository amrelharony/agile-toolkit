"use client";

/**
 * The improvement's number over time: log a dated reading (never for a day
 * that hasn't come yet), see the readings against the target on a run
 * chart (a sentence and a table say the same), and delete one with Undo
 * (focus moves to the next reading's delete, or the form's Day). Below two
 * readings there is no line to draw yet.
 */

import dynamic from "next/dynamic";
import { useEffect, useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ChartFigure } from "@/components/shared/chart-card";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ChartText } from "@/lib/charts/chart-text";
import { TOOL_TEXT_MAX, type Improvement } from "@/lib/stores/workspace-types";
import { isDay, progressToTarget, sortedReadings, valueText } from "@/lib/improve/model";
import { latestCheckInDay } from "@/lib/okrs/progress";
import { todayIso } from "@/lib/sprints/series";
import type { Validation } from "@/lib/utils/form";
import { parseValue } from "./fields";
import type { ItemActions } from "./use-item-actions";

const ReadingsChart = dynamic(() => import("./readings-chart").then((m) => m.ReadingsChart), {
  ssr: false,
});

/** Readings before the run chart has a line to draw. */
export const READINGS_MIN = 2;

/** Focus goes to the reading form's first field (its Day). */
const FORM = "form";

export interface ReadingDraft {
  date: string;
  value: string;
  note: string;
}

/** A reading's draft checked: a real day not after today, a number, a short note. */
export function validateReadingDraft(
  draft: ReadingDraft,
  latestDay: string = latestCheckInDay(todayIso(), false)
): Validation<{ date: string; value: number; note: string }, keyof ReadingDraft> {
  const errors: Partial<Record<keyof ReadingDraft, string>> = {};
  if (!isDay(draft.date)) errors.date = "Give the day as a real date.";
  else if (draft.date > latestDay)
    errors.date = "A reading can't be for a day that hasn't come yet.";
  const value = parseValue(draft.value);
  if (value === undefined) errors.value = "Give the reading as a number.";
  else if (!Number.isFinite(value)) errors.value = "Give a number, such as 6 or 1.5.";
  if (draft.note.trim().length > TOOL_TEXT_MAX.short)
    errors.note = `Keep it to ${TOOL_TEXT_MAX.short} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { date: draft.date, value: value as number, note: draft.note.trim() },
  };
}

/** The run chart's sentence and table. */
export function readingsText(item: Improvement): ChartText {
  const rows = sortedReadings(item);
  const unit = item.target.unit ?? item.current.unit;
  const show = (v: number) => valueText({ value: v, unit });
  const first = rows[0];
  const last = rows[rows.length - 1];
  const pct = progressToTarget(item);
  const target =
    item.target.value !== undefined
      ? ` The target is ${show(item.target.value)}${pct === null ? "" : `: ${pct}% of the way`}.`
      : "";
  const summary =
    rows.length === 0
      ? "No reading yet."
      : rows.length === 1
        ? `One reading: ${show(first.value)} on ${first.date}.${target}`
        : `${rows.length} readings, from ${show(first.value)} on ${first.date} to ${show(last.value)} on ${last.date}.${target}`;
  return {
    summary,
    table: {
      columns: ["Day", "Reading", "Note"],
      rows: rows.map((r) => [r.date, show(r.value), r.note ?? ""]),
      caption: "Readings, oldest first",
    },
  };
}

export function Readings({ item, actions }: { item: Improvement; actions: ItemActions }) {
  const ids = useId();
  const [error, setError] = useState<string | null>(null);
  const form = useItemForm({
    initial: (): ReadingDraft => ({ date: todayIso(), value: "", note: "" }),
    validate: (d) => validateReadingDraft(d),
    resetOnSave: false,
    onSave: (values) => {
      const why = actions.addReading(values);
      setError(why);
      if (!why) form.reset();
    },
  });
  const { draft, update, errors } = form;
  const rows = sortedReadings(item);
  const text = readingsText(item);
  const unit = item.target.unit ?? item.current.unit;
  // Newest first, as listed.
  const shown = [...rows].reverse();
  const [focusId, setFocusId] = useState<string | null>(null);
  const deleteId = (id: string) => `${ids}-reading-${id}-delete`;

  // After a delete, focus goes to the next reading's delete (or the form's Day).
  useEffect(() => {
    if (!focusId) return;
    const target =
      focusId === FORM
        ? form.formRef.current?.querySelector<HTMLElement>("input")
        : document.getElementById(focusId);
    target?.focus();
    setFocusId(null);
  }, [focusId, form.formRef]);

  const remove = (at: number) => {
    const reading = shown[at];
    const next = shown[at + 1] ?? shown[at - 1];
    actions.removeReading(reading);
    setFocusId(next ? deleteId(next.id) : FORM);
  };

  return (
    <section aria-labelledby={`${ids}-heading`} className="space-y-3">
      <h3 id={`${ids}-heading`} className="text-sm font-semibold text-text">
        Readings
      </h3>
      {rows.length < READINGS_MIN ? (
        <NotEnoughData
          have={rows.length}
          need={READINGS_MIN}
          unit={["reading", "readings"]}
          action="Log"
          what="the run chart"
        />
      ) : (
        <ChartFigure
          labelledBy={`${ids}-heading`}
          summary={text.summary}
          table={text.table}
          plotClassName="h-[220px]"
        >
          <ReadingsChart
            data={rows.map((r) => ({ date: r.date, value: r.value }))}
            target={item.target.value}
            start={item.current.value}
            unit={unit}
          />
        </ChartFigure>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {shown.map((r, i) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm"
            >
              <span className="font-mono text-xs text-sub">{r.date}</span>
              <span className="font-medium text-text">{valueText({ value: r.value, unit })}</span>
              {r.note && <span className="min-w-0 flex-1 break-words text-sub">{r.note}</span>}
              <Button
                id={deleteId(r.id)}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(i)}
                aria-label={`Delete the reading for ${r.date}`}
                className="ml-auto text-sub hover:text-danger"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ItemForm
        form={form}
        submitLabel="Log reading"
        submitIcon={<Plus aria-hidden="true" />}
        className="rounded-lg border border-dashed border-border p-3"
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="Day" error={errors.date} required>
            {(props) => (
              <Input
                {...props}
                type="date"
                max={latestCheckInDay(todayIso(), false)}
                value={draft.date}
                onChange={(e) => update({ date: e.target.value })}
              />
            )}
          </Field>
          <Field label={unit ? `Reading (${unit})` : "Reading"} error={errors.value} required>
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={draft.value}
                onChange={(e) => update({ value: e.target.value })}
              />
            )}
          </Field>
          <Field label="Note" error={errors.note}>
            {(props) => (
              <Input
                {...props}
                value={draft.note}
                maxLength={TOOL_TEXT_MAX.short}
                onChange={(e) => update({ note: e.target.value })}
              />
            )}
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </ItemForm>
    </section>
  );
}
