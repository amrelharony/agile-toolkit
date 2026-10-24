"use client";

import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { RefFor } from "@/hooks/use-return-focus";
import type { DoraSample } from "@/lib/stores/workspace-types";
import {
  DORA_METRICS,
  DORA_METRIC_LABEL,
  doraBand,
  formatMetric,
  type DoraBand,
} from "@/lib/dora/bands";
import { isDashQuarter } from "@/lib/roadmap/quarters";
import { loggedQuarters } from "@/lib/dora/samples";
import { provenanceText } from "@/lib/dora/derive";
import { localDay } from "@/lib/sprints/series";
import { cn } from "@/lib/utils";
import { draftFrom, validateDoraDraft, type DoraValues } from "./form";
import { SampleFields } from "./sample-fields";

/** A band's colour, with its name always beside it (colour is never the only cue). */
export const BAND_TEXT: Record<DoraBand, string> = {
  Elite: "text-success",
  High: "text-info",
  Medium: "text-warning",
  Low: "text-danger",
};

function SampleEditor({
  sample,
  samples,
  now,
  today,
  onSave,
  onCancel,
}: {
  sample: DoraSample;
  samples: readonly DoraSample[];
  now: Date;
  today: string;
  onSave: (values: DoraValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm({
    initial: () => draftFrom(sample),
    validate: (d) => validateDoraDraft(d, { samples, today, editingId: sample.id }),
    onSave: (values) => onSave(values),
    resetOnSave: false,
  });
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <SampleFields form={form} now={now} logged={loggedQuarters(samples, sample.id)} />
    </ItemForm>
  );
}

/**
 * One logged quarter: its four numbers with their bands, where they came
 * from, and Edit (in place, under the same checks as a new one) and Delete
 * (with Undo).
 */
export function SampleRow({
  sample,
  samples,
  editing,
  now,
  today,
  refFor,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  sample: DoraSample;
  samples: readonly DoraSample[];
  editing: boolean;
  now: Date;
  today: string;
  refFor: RefFor;
  onEdit: (s: DoraSample) => void;
  onSave: (s: DoraSample, values: DoraValues) => void;
  onCancel: (s: DoraSample) => void;
  onDelete: (s: DoraSample) => void;
}) {
  const label = sample.quarter || "Undated sample";
  return (
    <li className="rounded-lg border border-border bg-card p-3" aria-label={label}>
      {editing ? (
        <>
          <h3 className="mb-3 text-sm font-semibold text-text">Edit {label}</h3>
          <SampleEditor
            sample={sample}
            samples={samples}
            now={now}
            today={today}
            onSave={(values) => onSave(sample, values)}
            onCancel={() => onCancel(sample)}
          />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-data text-sm font-semibold text-text">{label}</h3>
              <Badge variant="outline" className="text-xs font-normal text-sub">
                {sample.source === "derived" ? "From your data" : "Typed"}
              </Badge>
              {!isDashQuarter(sample.quarter) && (
                <span className="text-xs text-warning">
                  Quarter not in YYYY-Qn form: edit to fix
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <IconButton
                ref={refFor(`edit:${sample.id}`)}
                label={`Edit ${label}`}
                icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
                onClick={() => onEdit(sample)}
              />
              <IconButton
                ref={refFor(`delete:${sample.id}`)}
                label={`Delete ${label}`}
                icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                onClick={() => onDelete(sample)}
                className="hover:text-danger"
              />
            </div>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
            {DORA_METRICS.map((m) => {
              const band = doraBand(m, sample[m]);
              return (
                <div key={m} className="min-w-0">
                  <dt className="text-xs text-sub">{DORA_METRIC_LABEL[m]}</dt>
                  <dd className="font-data text-sm text-text">
                    {formatMetric(m, sample[m])}{" "}
                    {band && (
                      <span className={cn("text-xs font-medium", BAND_TEXT[band])}>{band}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          {sample.description && (
            <p className="mt-2 whitespace-pre-wrap break-words text-xs text-sub">
              {sample.description}
            </p>
          )}
          {sample.source === "derived" && sample.derivedFrom && (
            <p className="mt-1 text-xs text-sub">{provenanceText(sample.derivedFrom)}</p>
          )}
          {sample.updatedAt && (
            <p className="mt-1 text-xs text-sub">Edited {localDay(sample.updatedAt)}</p>
          )}
        </>
      )}
    </li>
  );
}
