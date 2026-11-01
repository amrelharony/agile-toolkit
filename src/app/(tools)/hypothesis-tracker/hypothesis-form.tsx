"use client";

/**
 * "New hypothesis" (a button that opens the form) and the editor that
 * opens in place on a card. Nothing is saved until lib/hypotheses'
 * validateHypothesis passes: a failed save shows what's missing and
 * focuses it. Enter saves, Escape closes.
 */

import { useEffect, useRef, useState } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import type { Hypothesis } from "@/lib/stores/workspace-types";
import {
  emptyHypothesisDraft,
  hypothesisDraftFrom,
  validateHypothesis,
  type HypothesisDraft,
  type HypothesisField,
  type HypothesisValues,
} from "@/lib/hypotheses/model";
import { HypothesisFields } from "./hypothesis-fields";

export function NewHypothesisForm({
  today,
  onAdd,
}: {
  today: string;
  onAdd: (values: HypothesisValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const reopenFocus = useRef(false);
  const form = useItemForm<HypothesisDraft, HypothesisValues, HypothesisField>({
    initial: () => emptyHypothesisDraft(today),
    validate: (d) => validateHypothesis(d, today),
    onSave: (values) => {
      onAdd(values);
      close();
    },
  });
  const { formRef, reset } = form;

  function close() {
    setOpen(false);
    reset();
    reopenFocus.current = true;
  }

  // Open on the first line; closed, back to the button that opened it.
  useEffect(() => {
    if (open) formRef.current?.querySelector<HTMLElement>("input")?.focus();
    else if (reopenFocus.current) {
      reopenFocus.current = false;
      openerRef.current?.focus();
    }
  }, [open, formRef]);

  if (!open) {
    return (
      <Button
        ref={openerRef}
        variant="toolkit"
        className="gap-2"
        onClick={() => setOpen(true)}
        // The page focuses it once a delete empties the list.
        data-new-hypothesis=""
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        New hypothesis
      </Button>
    );
  }

  return (
    <SectionCard title="New hypothesis" icon={Lightbulb} className="w-full">
      <ItemForm
        form={form}
        submitLabel="Add hypothesis"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        onCancel={close}
      >
        <HypothesisFields form={form} today={today} />
      </ItemForm>
    </SectionCard>
  );
}

/** Edit in place: the same fields with this hypothesis's values. Enter saves, Escape cancels. */
export function HypothesisEditor({
  hypothesis,
  today,
  onSave,
  onCancel,
}: {
  hypothesis: Hypothesis;
  today: string;
  onSave: (values: HypothesisValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<HypothesisDraft, HypothesisValues, HypothesisField>({
    initial: () => hypothesisDraftFrom(hypothesis),
    // What the row holds already (a long text, a day an agent stamped) is kept.
    validate: (d) => validateHypothesis(d, today, { stored: hypothesis }),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <div className="rounded-lg border border-accent/40 bg-card p-3 sm:p-4">
      <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
        <HypothesisFields form={form} today={today} stored={hypothesis} />
      </ItemForm>
    </div>
  );
}
