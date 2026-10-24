"use client";

import { useState } from "react";
import Link from "next/link";
import { Database, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { DoraDerivedFrom, DoraSample } from "@/lib/stores/workspace-types";
import { loggedQuarters, sampleFor } from "@/lib/dora/samples";
import { leadBasisText, provenanceText, type DoraDerivation } from "@/lib/dora/derive";
import type { DoraMetric } from "@/lib/dora/bands";
import {
  draftWithDerivation,
  emptyDraft,
  validateDoraDraft,
  type DoraDraftField,
  type DoraValues,
} from "./form";
import { SampleFields } from "./sample-fields";

/** Where to go for the data a metric couldn't be worked out from. */
const FIX: Record<DoraMetric, { href: string; label: string }> = {
  deployFreqPerWeek: { href: "/release-readiness", label: "Release Readiness" },
  changeFailRate: { href: "/release-readiness", label: "Release Readiness" },
  leadTimeHours: { href: "/kanban", label: "Kanban" },
  mttrHours: { href: "/incident-commander", label: "Incident Commander" },
};

const FIELD_METRIC: Partial<Record<DoraDraftField, DoraMetric>> = {
  deployFreqPerWeek: "deployFreqPerWeek",
  leadTimeHours: "leadTimeHours",
  changeFailRatePct: "changeFailRate",
  mttrHours: "mttrHours",
};

/**
 * "Log a quarter": pick the quarter (the latest without a sample is
 * picked to start with), type the four numbers or fill them from the
 * team's releases, boards and incidents, and save. Every derived number
 * stays editable; a metric the data can't give stays empty, with a link to
 * where its data lives. A quarter already logged offers its row's editor.
 */
export function LogForm({
  samples,
  defaultQuarter,
  now,
  today,
  derive,
  onAdd,
  onEdit,
}: {
  samples: readonly DoraSample[];
  defaultQuarter: string;
  now: Date;
  today: string;
  derive: (quarter: string) => DoraDerivation | null;
  onAdd: (values: DoraValues, derived?: { quarter: string; derivedFrom: DoraDerivedFrom }) => void;
  /** Open the editor of an existing sample. */
  onEdit: (sample: DoraSample) => void;
}) {
  const [derivation, setDerivation] = useState<DoraDerivation | null>(null);
  const form = useItemForm({
    initial: () => emptyDraft(defaultQuarter),
    validate: (d) => validateDoraDraft(d, { samples, today }),
    onSave: (values) => {
      onAdd(
        values,
        derivation && derivation.quarter === values.quarter
          ? { quarter: derivation.quarter, derivedFrom: derivation.derivedFrom }
          : undefined
      );
      setDerivation(null);
    },
  });
  // The form starts again on the next quarter to log once this one is saved.
  const reset = form.reset;
  const logged = loggedQuarters(samples);
  const existing = form.draft.quarter ? sampleFor(samples, form.draft.quarter) : undefined;
  const shown = derivation && derivation.quarter === form.draft.quarter ? derivation : null;

  const fill = () => {
    const d = derive(form.draft.quarter);
    if (!d) return;
    setDerivation(d);
    form.update(draftWithDerivation(form.draft, d));
  };

  const metricNote = (field: DoraDraftField) => {
    const metric = FIELD_METRIC[field];
    const why = shown && metric ? shown.missing[metric] : undefined;
    if (!why || !metric) return null;
    return (
      <span className="text-warning">
        {why}{" "}
        <Link href={FIX[metric].href} className="font-medium text-accent hover:underline">
          {FIX[metric].label}
        </Link>
      </span>
    );
  };

  return (
    <ItemForm
      form={form}
      submitLabel="Save quarter"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      footer={
        <Button
          type="button"
          variant="outline"
          onClick={fill}
          disabled={!form.draft.quarter || Boolean(existing)}
          className="gap-1"
        >
          <Database className="h-4 w-4" aria-hidden="true" />
          Fill from your data
        </Button>
      }
    >
      <SampleFields
        form={form}
        now={now}
        logged={logged}
        metricNote={metricNote}
        quarterNote={
          existing ? (
            <p className="mt-1.5 text-xs text-sub">
              {form.draft.quarter} is logged already.{" "}
              <button
                type="button"
                className="font-medium text-accent underline-offset-2 hover:underline"
                onClick={() => {
                  onEdit(existing);
                  reset();
                }}
              >
                Edit {form.draft.quarter}
              </button>
            </p>
          ) : null
        }
      />
      {shown && (
        <div
          role="status"
          className="rounded-lg border border-border bg-surface p-3 text-xs text-sub"
        >
          <p className="font-medium text-text">{provenanceText(shown.derivedFrom)}</p>
          <p className="mt-1">{leadBasisText(shown)}</p>
          {shown.inProgress && (
            <p className="mt-1">
              {shown.quarter} is still running: deploys a week are over the{" "}
              {Math.round(shown.weeks * 10) / 10} weeks so far.
            </p>
          )}
        </div>
      )}
    </ItemForm>
  );
}
