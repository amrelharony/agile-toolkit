"use client";

import { useState } from "react";
import { Database, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { DoraDerivedFrom, DoraSample } from "@/lib/stores/workspace-types";
import { loggedQuarters, sampleCoverage, sampleFor } from "@/lib/dora/samples";
import type { DoraDerivation } from "@/lib/dora/derive";
import {
  draftWithDerivation,
  emptyDraft,
  nextQuarterToLog,
  savedProvenance,
  typedOverrides,
  validateDoraDraft,
  type DoraDraft,
  type DoraValues,
} from "./form";
import { DerivationPanel, metricNoteFor } from "./derivation-note";
import { SampleFields } from "./sample-fields";

/**
 * "Log a quarter": pick the quarter (the latest finished one without a
 * sample is picked to start with), type the four numbers or fill them from
 * the team's releases, boards and incidents, and save. Every derived number
 * stays editable; a metric the data can't give stays empty, with a link to
 * where its data lives. A quarter already logged offers its row's editor,
 * carrying over what was typed here.
 *
 * The form stays mounted after a save (it starts again on the next quarter
 * to log in place), so keyboard focus stays where it was.
 */
export function LogForm({
  samples,
  defaultQuarter,
  now,
  today,
  derive,
  onAdd,
  onEdit,
  quarterRef,
}: {
  samples: readonly DoraSample[];
  defaultQuarter: string;
  now: Date;
  today: string;
  derive: (quarter: string) => DoraDerivation | null;
  onAdd: (values: DoraValues, derived?: { quarter: string; derivedFrom: DoraDerivedFrom }) => void;
  /** Open the editor of an existing sample, with what was typed here in it. */
  onEdit: (sample: DoraSample, typed: Partial<DoraDraft>) => void;
  /** The quarter picker, for focus to land on when the last row goes. */
  quarterRef?: (el: HTMLElement | null) => void;
}) {
  const [derivation, setDerivation] = useState<DoraDerivation | null>(null);
  const form = useItemForm({
    initial: () => emptyDraft(defaultQuarter),
    validate: (d) => validateDoraDraft(d, { samples, today }),
    onSave: (values) => {
      const from = derivation ? savedProvenance(derivation, values) : null;
      onAdd(values, from ? { quarter: values.quarter, derivedFrom: from } : undefined);
      setDerivation(null);
      // Start again on the next quarter to log, counting the one just saved.
      form.reset(emptyDraft(nextQuarterToLog([...samples, { id: "", ...values }], now)));
    },
    resetOnSave: false,
  });
  const logged = loggedQuarters(samples);
  const existing = form.draft.quarter ? sampleFor(samples, form.draft.quarter) : undefined;
  const shown = derivation && derivation.quarter === form.draft.quarter ? derivation : null;
  const running =
    !existing &&
    form.draft.quarter !== "" &&
    sampleCoverage({ quarter: form.draft.quarter }, today) === "running";
  const typed = typedOverrides(form.draft);
  const carries = Object.keys(typed).length > 0;

  const fill = () => {
    const d = derive(form.draft.quarter);
    if (!d) return;
    setDerivation(d);
    form.update(draftWithDerivation(form.draft, d));
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
        quarterRef={quarterRef}
        metricNote={metricNoteFor(shown)}
        quarterNote={
          existing ? (
            <p className="mt-1.5 text-xs text-sub">
              {form.draft.quarter} is logged already.{" "}
              <button
                type="button"
                className="font-medium text-accent underline-offset-2 hover:underline"
                onClick={() => {
                  onEdit(existing, typed);
                  form.reset();
                }}
              >
                {carries
                  ? `Edit ${form.draft.quarter} with these numbers`
                  : `Edit ${form.draft.quarter}`}
              </button>
            </p>
          ) : running ? (
            <p className="mt-1.5 text-xs text-sub">
              {form.draft.quarter} is still running: its numbers cover the weeks so far. Saved now,
              its row says so until you save it again after the quarter ends.
            </p>
          ) : null
        }
      />
      {shown && <DerivationPanel shown={shown} />}
    </ItemForm>
  );
}
