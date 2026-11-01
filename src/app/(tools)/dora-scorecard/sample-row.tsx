"use client";

import { useEffect, useState } from "react";
import { Database, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { RefFor } from "@/hooks/use-return-focus";
import type { DoraDerivedFrom, DoraSample } from "@/lib/stores/workspace-types";
import {
  DORA_METRICS,
  DORA_METRIC_LABEL,
  doraBand,
  formatMetric,
  type DoraBand,
} from "@/lib/dora/bands";
import { isDashQuarter } from "@/lib/roadmap/quarters";
import { loggedQuarters, sampleCoverage } from "@/lib/dora/samples";
import { sampleOrigin, sampleSourceText, type DoraDerivation } from "@/lib/dora/derive";
import { localDay } from "@/lib/sprints/series";
import { cn } from "@/lib/utils";
import {
  draftFrom,
  draftWithDerivation,
  savedProvenance,
  validateDoraDraft,
  type DoraDraft,
  type DoraValues,
} from "./form";
import { DerivationPanel, metricNoteFor } from "./derivation-note";
import { SampleFields } from "./sample-fields";

/** What a row's editor saves: the values, and what a refill from the data kept. */
export type RefillResult = { quarter: string; derivedFrom: DoraDerivedFrom | null };

const ORIGIN_BADGE = {
  derived: "From your data",
  partly: "Partly from your data",
  typed: "Typed",
} as const;

/** A band's colour, with its name always beside it (colour is never the only cue). */
export const BAND_TEXT: Record<DoraBand, string> = {
  Elite: "text-success",
  High: "text-info",
  Medium: "text-warning",
  Low: "text-danger",
};

/**
 * A row's editor. It takes the focus when it opens (the Edit button that
 * had it is gone) and scrolls into view, since "Edit 2026-Q3" in the log
 * form can open one far down the page. `seed` is what was typed there.
 * "Refill from your data" works the quarter out again, so a sample logged
 * while its quarter ran can be brought up to the whole quarter.
 */
function SampleEditor({
  sample,
  samples,
  seed,
  now,
  today,
  derive,
  onSave,
  onCancel,
}: {
  sample: DoraSample;
  samples: readonly DoraSample[];
  seed?: Partial<DoraDraft>;
  now: Date;
  today: string;
  derive: (quarter: string) => DoraDerivation | null;
  onSave: (values: DoraValues, refill?: RefillResult) => void;
  onCancel: () => void;
}) {
  const [derivation, setDerivation] = useState<DoraDerivation | null>(null);
  const form = useItemForm({
    initial: () => ({ ...draftFrom(sample), ...seed }),
    validate: (d) => validateDoraDraft(d, { samples, today, editingId: sample.id }),
    onSave: (values) =>
      onSave(
        values,
        derivation && derivation.quarter === values.quarter
          ? { quarter: values.quarter, derivedFrom: savedProvenance(derivation, values) }
          : undefined
      ),
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    const first = formRef.current?.querySelector<HTMLElement>("select, input, textarea");
    first?.focus();
    // jsdom has no scrollIntoView.
    first?.scrollIntoView?.({ block: "nearest" });
  }, [formRef]);
  const shown = derivation && derivation.quarter === form.draft.quarter ? derivation : null;

  const refill = () => {
    const d = derive(form.draft.quarter);
    if (!d) return;
    setDerivation(d);
    form.update(draftWithDerivation(form.draft, d));
  };

  return (
    <ItemForm
      form={form}
      submitLabel="Save"
      onCancel={onCancel}
      footer={
        <Button
          type="button"
          variant="outline"
          onClick={refill}
          disabled={!form.draft.quarter}
          className="gap-1"
        >
          <Database className="h-4 w-4" aria-hidden="true" />
          Refill from your data
        </Button>
      }
    >
      {seed && Object.keys(seed).length > 0 && (
        <p className="text-xs text-sub">
          The numbers you typed in Log a quarter are in: Save to replace the stored ones, or Cancel
          to keep them.
        </p>
      )}
      <SampleFields
        form={form}
        now={now}
        logged={loggedQuarters(samples, sample.id)}
        metricNote={metricNoteFor(shown)}
      />
      {shown && <DerivationPanel shown={shown} />}
    </ItemForm>
  );
}

/** A sample that covers only part of its quarter, in words; null when it covers it all. */
function coverageText(sample: DoraSample, today: string): { badge: string; text: string } | null {
  const c = sampleCoverage(sample, today);
  if (c === "running") {
    return {
      badge: "In progress",
      text: `${sample.quarter} is still running: these are its numbers so far.`,
    };
  }
  if (c === "early") {
    return {
      badge: "Partial quarter",
      text: `Saved ${localDay(sample.updatedAt)}, before ${sample.quarter} ended: edit it (or refill it from your data) for the whole quarter.`,
    };
  }
  return null;
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
  seed,
  now,
  today,
  derive,
  refFor,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  sample: DoraSample;
  samples: readonly DoraSample[];
  editing: boolean;
  /** What the log form had typed, when its "Edit 2026-Q3" opened this editor. */
  seed?: Partial<DoraDraft>;
  now: Date;
  today: string;
  derive: (quarter: string) => DoraDerivation | null;
  refFor: RefFor;
  onEdit: (s: DoraSample) => void;
  onSave: (s: DoraSample, values: DoraValues, refill?: RefillResult) => void;
  onCancel: (s: DoraSample) => void;
  onDelete: (s: DoraSample) => void;
}) {
  const label = sample.quarter || "Undated sample";
  const origin = sampleOrigin(sample);
  const coverage = coverageText(sample, today);
  return (
    <li className="rounded-lg border border-border bg-card p-3" aria-label={label}>
      {editing ? (
        <>
          <h3 className="mb-3 text-sm font-semibold text-text">Edit {label}</h3>
          <SampleEditor
            sample={sample}
            samples={samples}
            seed={seed}
            now={now}
            today={today}
            derive={derive}
            onSave={(values, refill) => onSave(sample, values, refill)}
            onCancel={() => onCancel(sample)}
          />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-data text-sm font-semibold text-text">{label}</h3>
              <Badge variant="outline" className="text-xs font-normal text-sub">
                {ORIGIN_BADGE[origin]}
              </Badge>
              {coverage && (
                <Badge variant="outline" className="text-xs font-normal text-warning">
                  {coverage.badge}
                </Badge>
              )}
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
          {origin !== "typed" && sample.derivedFrom && (
            <p className="mt-1 text-xs text-sub">{sampleSourceText(sample)}</p>
          )}
          {coverage && <p className="mt-1 text-xs text-warning">{coverage.text}</p>}
          {sample.updatedAt && !coverage && (
            <p className="mt-1 text-xs text-sub">Saved {localDay(sample.updatedAt)}</p>
          )}
        </>
      )}
    </li>
  );
}
