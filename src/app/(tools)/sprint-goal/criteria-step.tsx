"use client";

import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { Validation } from "@/lib/utils/form";
import { validateSmart, type AcceptanceCriterion } from "./smart";
import { CRITERION_TIPS, SmartBadges } from "./smart-badges";
import { focusAfterRemoval } from "./focus";

interface CriterionDraft {
  text: string;
}

/** A new criterion needs its text; it is never added blank. */
export function validateCriterion(
  draft: CriterionDraft
): Validation<CriterionDraft, keyof CriterionDraft> {
  const text = draft.text.trim();
  return text
    ? { ok: true, values: { text } }
    : { ok: false, errors: { text: "Write the criterion before adding it." } };
}

/**
 * Step 3: the goal's acceptance criteria, each edited in place with its
 * SMART badges, plus a draft-then-save form for the next one (Add used to
 * append a blank criterion).
 */
export function CriteriaStep({
  criteria,
  onAdd,
  onEdit,
  onToggleRelevant,
  onRemove,
}: {
  criteria: readonly AcceptanceCriterion[];
  onAdd: (text: string) => void;
  onEdit: (id: string, text: string) => void;
  onToggleRelevant: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const form = useItemForm<CriterionDraft, CriterionDraft>({
    initial: { text: "" },
    validate: validateCriterion,
    onSave: (values) => onAdd(values.text),
  });
  const listRef = useRef<HTMLOListElement>(null);

  // The pressed button goes with its row: land on the next row's, or on
  // the add field once the list is empty.
  const remove = (id: string, index: number) => {
    onRemove(id);
    focusAfterRemoval(listRef, "[data-remove-criterion]", index, () =>
      form.formRef.current?.querySelector<HTMLElement>("input")
    );
  };

  return (
    <>
      <h2 className="text-lg font-semibold text-text mb-2">Acceptance Criteria</h2>
      <p className="text-sm text-sub mb-4">
        Define measurable criteria that determine when the sprint goal is met. Each criterion is
        validated against SMART principles.
      </p>

      {criteria.length > 0 && (
        <ol ref={listRef} className="space-y-4" aria-label="Acceptance criteria">
          {criteria.map((criterion, i) => (
            <li key={criterion.id} className="p-4 rounded-lg bg-card border border-border">
              <div className="flex gap-2 mb-3">
                <BlurTextarea
                  aria-label={`Acceptance criterion ${i + 1}`}
                  placeholder="e.g., 90% of new users complete onboarding within 3 minutes by end of sprint"
                  value={criterion.text}
                  onCommit={(v) => onEdit(criterion.id, v)}
                  className="flex-1 min-h-[60px] bg-card border-border text-text placeholder:text-sub/50 focus:border-accent-cyan/50 focus:ring-accent-cyan/20"
                />
                <IconButton
                  label={`Remove acceptance criterion ${i + 1}`}
                  icon={<Trash2 className="w-4 h-4" />}
                  onClick={() => remove(criterion.id, i)}
                  data-remove-criterion=""
                  className="min-touch-coarse text-sub hover:text-danger hover:bg-danger/10 shrink-0"
                />
              </div>
              {criterion.text.trim().length > 0 && (
                <SmartBadges
                  result={validateSmart(criterion)}
                  tips={CRITERION_TIPS}
                  relevantControl={
                    <input
                      type="checkbox"
                      checked={criterion.relevantChecked}
                      onChange={() => onToggleRelevant(criterion.id)}
                      aria-label={`Criterion ${i + 1} serves the sprint goal`}
                      title="Confirm this criterion is relevant to the sprint goal"
                      className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                    />
                  }
                />
              )}
            </li>
          ))}
        </ol>
      )}

      <ItemForm
        form={form}
        submitLabel="Add criterion"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        className="mt-4"
      >
        <Field
          label={
            criteria.length === 0 ? "First acceptance criterion" : "Another acceptance criterion"
          }
          hint="Something you can check at the review. A number and a deadline make it SMART."
          error={form.errors.text}
        >
          {(control) => (
            <Input
              {...control}
              value={form.draft.text}
              onChange={(e) => form.update({ text: e.target.value })}
              placeholder="e.g., 90% of new users finish onboarding within 3 minutes by end of sprint"
            />
          )}
        </Field>
      </ItemForm>
    </>
  );
}
