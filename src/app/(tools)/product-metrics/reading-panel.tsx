"use client";

/**
 * Readings for one metric: add one (a second on the same day replaces the
 * first), paste up to 52 lines of "YYYY-MM-DD, value" with bad lines named
 * inline, and remove one with Undo. The page does the writes.
 */

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MetricReading, ProductMetric } from "@/lib/stores/workspace-types";
import { formatMetric } from "@/lib/hypotheses/model";
import {
  PASTE_LINES_MAX,
  READING_NOTE_MAX,
  parseReadingsPaste,
  sortedReadings,
  validateReading,
  type PasteProblem,
  type ReadingDraft,
  type ReadingField,
  type ReadingValues,
} from "@/lib/product-metrics/model";

/** Characters a paste box takes: 52 lines with room for notes and spaces. */
const PASTE_MAX = PASTE_LINES_MAX * 60;

export function ReadingPanel({
  metric,
  today,
  onAdd,
  onImport,
  onRemove,
  onClose,
}: {
  metric: ProductMetric;
  today: string;
  onAdd: (values: ReadingValues) => void;
  onImport: (readings: ReadingValues[]) => void;
  onRemove: (reading: MetricReading) => void;
  onClose: () => void;
}) {
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");
  const [problems, setProblems] = useState<PasteProblem[]>([]);
  const [pasteError, setPasteError] = useState<string | undefined>();
  const form = useItemForm<ReadingDraft, ReadingValues, ReadingField>({
    initial: { date: today, value: "", note: "" },
    validate: (d) => validateReading(d, today),
    onSave: (values) => onAdd(values),
  });
  const { draft, update, errors } = form;
  const recent = sortedReadings(metric).slice(-6).reverse();

  const importPaste = () => {
    const parsed = parseReadingsPaste(paste, today);
    setProblems(parsed.problems);
    if (parsed.readings.length === 0) {
      setPasteError("No line could be read. Write one reading per line: 2026-05-01, 42.");
      return;
    }
    setPasteError(undefined);
    onImport(parsed.readings);
    if (parsed.problems.length === 0) {
      setPaste("");
      setPasting(false);
    }
  };

  return (
    <section
      aria-label={`Readings for ${metric.name}`}
      className="space-y-3 rounded-lg border border-border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="break-words text-sm font-medium text-text">Readings for {metric.name}</h3>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
      <ItemForm form={form} submitLabel="Add the reading">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Day" error={errors.date} required>
            {(props) => (
              <Input
                {...props}
                type="date"
                max={today}
                value={draft.date}
                onChange={(e) => update({ date: e.target.value })}
              />
            )}
          </Field>
          <Field
            label={metric.unit ? `Value (${metric.unit})` : "Value"}
            error={errors.value}
            required
          >
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
                maxLength={READING_NOTE_MAX}
                value={draft.note}
                onChange={(e) => update({ note: e.target.value })}
              />
            )}
          </Field>
        </div>
      </ItemForm>
      {pasting ? (
        <div className="space-y-2">
          <Field
            label="Paste readings"
            hint={`One per line, the day then the value: 2026-05-01, 42. Up to ${PASTE_LINES_MAX} lines; a day already read is replaced.`}
            error={pasteError}
          >
            {(props) => (
              <Textarea
                {...props}
                rows={5}
                maxLength={PASTE_MAX}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
              />
            )}
          </Field>
          {problems.length > 0 && (
            <ul className="space-y-0.5 text-xs text-danger" aria-label="Lines not read">
              {problems.map((p) => (
                <li key={p.line} className="break-words">
                  Line {p.line} (“{p.text}”): {p.reason}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={importPaste}>
              Add these readings
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPasting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setPasting(true)}>
          Paste readings
        </Button>
      )}
      {recent.length > 0 && (
        <ul className="divide-y divide-border text-sm" aria-label="Latest readings">
          {recent.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-1">
              <span className="min-w-0 break-words">
                <span className="font-data">{r.date}</span>: {formatMetric(r.value, metric.unit)}
                {r.note ? ` · ${r.note}` : ""}
              </span>
              <IconButton
                label={`Remove the reading of ${r.date}`}
                icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                onClick={() => onRemove(r)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
