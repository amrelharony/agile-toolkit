"use client";

/**
 * Adding an assumption, and editing its words in place. The statement is
 * needed; the ratings start unset and may stay so (the assumption is then
 * "Not rated" and waits outside the ranking). Enter saves; Escape cancels
 * the editor.
 */

import { useEffect } from "react";
import { Plus, ShieldAlert } from "lucide-react";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { ScalePicker } from "@/components/shared/scale-picker";
import { SectionCard } from "@/components/shared/section-card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ASSUMPTION_STATEMENT_MAX, ASSUMPTION_TEXT_MAX } from "@/lib/assumptions/model";
import type { Assumption } from "@/lib/stores/workspace-types";
import {
  EVIDENCE_STEPS,
  RISK_STEPS,
  assumptionDraftFrom,
  emptyAssumptionDraft,
  validateAssumption,
  type AssumptionDraft,
  type AssumptionField,
  type AssumptionValues,
} from "./form";

type FormState = ItemFormState<AssumptionDraft, AssumptionField>;

const capFor = (max: number, stored: string | undefined) => Math.max(max, (stored ?? "").length);

function WordFields({ form, stored }: { form: FormState; stored?: Assumption }) {
  const { draft, update, errors } = form;
  return (
    <>
      <Field label="Assumption" error={errors.statement} required>
        {(props) => (
          <Input
            {...props}
            maxLength={capFor(ASSUMPTION_STATEMENT_MAX, stored?.statement)}
            value={draft.statement}
            onChange={(e) => update({ statement: e.target.value })}
            placeholder="Teams will pay $20 a month for the premium tier"
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label="Test idea"
          hint="Optional. The cheapest way to find out; it becomes what the test will do."
          error={errors.testIdea}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={capFor(ASSUMPTION_TEXT_MAX, stored?.testIdea)}
              value={draft.testIdea}
              onChange={(e) => update({ testIdea: e.target.value })}
              className="resize-none"
            />
          )}
        </Field>
        <Field
          label="Description"
          hint="Optional. Why the team believes it; it becomes what the test should teach."
          error={errors.description}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={capFor(ASSUMPTION_TEXT_MAX, stored?.description)}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              className="resize-none"
            />
          )}
        </Field>
      </div>
    </>
  );
}

export function AddAssumptionForm({ onAdd }: { onAdd: (values: AssumptionValues) => void }) {
  const form = useItemForm<AssumptionDraft, AssumptionValues, AssumptionField>({
    initial: emptyAssumptionDraft,
    validate: (d) => validateAssumption(d),
    onSave: onAdd,
  });
  const { draft, update } = form;
  return (
    <SectionCard title="Add an assumption" icon={ShieldAlert}>
      <ItemForm
        form={form}
        submitLabel="Add assumption"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      >
        <WordFields form={form} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ScalePicker
            label="Risk"
            size="sm"
            steps={RISK_STEPS}
            value={draft.riskLevel}
            onValueChange={(v) => update({ riskLevel: v })}
            onClear={() => update({ riskLevel: null })}
            hint={
              draft.riskLevel === null
                ? "Optional. How badly the plan suffers if it's wrong: 1 little harm, 5 the plan fails."
                : RISK_STEPS.find((s) => s.value === draft.riskLevel)?.meaning
            }
          />
          <ScalePicker
            label="Evidence"
            size="sm"
            steps={EVIDENCE_STEPS}
            value={draft.evidenceLevel}
            onValueChange={(v) => update({ evidenceLevel: v })}
            onClear={() => update({ evidenceLevel: null })}
            hint={
              draft.evidenceLevel === null
                ? "Optional. How much backs it today: 1 a guess, 5 strong data."
                : EVIDENCE_STEPS.find((s) => s.value === draft.evidenceLevel)?.meaning
            }
          />
        </div>
        <p className="text-xs text-sub">
          Leave the ratings blank if you haven&rsquo;t agreed them yet: it waits under &ldquo;Not
          rated&rdquo; and isn&rsquo;t ranked until both are set.
        </p>
      </ItemForm>
    </SectionCard>
  );
}

/** Edit the words in place; the ratings stay as they are (they're edited on the card). */
export function AssumptionEditor({
  assumption,
  onSave,
  onCancel,
}: {
  assumption: Assumption;
  onSave: (values: AssumptionValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<AssumptionDraft, AssumptionValues, AssumptionField>({
    initial: () => assumptionDraftFrom(assumption),
    validate: (d) => validateAssumption(d, assumption),
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
        <WordFields form={form} stored={assumption} />
      </ItemForm>
    </div>
  );
}
