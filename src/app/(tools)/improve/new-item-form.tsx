"use client";

/**
 * Start an improvement: what you'll improve, and A3 or Improvement Kata.
 * The method is fixed once it starts (an A3 and a Kata hold different
 * things). From a Root Cause analysis (`?from=`) the form opens with its
 * title and A3 picked, and says what it brings along; nothing is saved
 * until Start.
 */

import { useId } from "react";
import { Play } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TOOL_TEXT_MAX, type ImprovementMethod } from "@/lib/stores/workspace-types";
import { METHOD_LABEL, validateImprovementDraft, type ImprovementDraft } from "@/lib/improve/model";
import { cn } from "@/lib/utils";

export { validateImprovementDraft };

const METHOD_HINT: Record<ImprovementMethod, string> = {
  a3: "One page: why it matters, where things stand, the cause, what you'll change and whether it worked.",
  kata: "A target a few weeks away, reached in small experiments with a short coaching talk after each.",
};

export interface NewItemValues {
  title: string;
  method: ImprovementMethod;
}

export function NewItemForm({
  initial,
  fromLabel,
  onCreate,
  onCancel,
}: {
  initial?: Partial<ImprovementDraft>;
  /** What a Root Cause analysis brings along, said above the fields. */
  fromLabel?: string;
  onCreate: (values: NewItemValues) => void;
  onCancel?: () => void;
}) {
  const ids = useId();
  const form = useItemForm({
    initial: (): ImprovementDraft => ({ title: "", method: "", ...initial }),
    validate: validateImprovementDraft,
    onSave: (values) => onCreate(values),
  });
  const { draft, update, errors } = form;

  return (
    <ItemForm
      form={form}
      submitLabel="Start"
      submitIcon={<Play aria-hidden="true" />}
      onCancel={onCancel}
    >
      {fromLabel && (
        <p
          role="status"
          className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-text"
        >
          {fromLabel}
        </p>
      )}
      <Field label="What you'll improve" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            maxLength={TOOL_TEXT_MAX.short}
            placeholder="Releases wait six days after merge"
            onChange={(e) => update({ title: e.target.value })}
          />
        )}
      </Field>
      <fieldset aria-describedby={errors.method ? `${ids}-method-error` : undefined}>
        <legend className="mb-1.5 text-sm text-text">How</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["a3", "kata"] as const).map((m) => (
            <label
              key={m}
              className={cn(
                "flex min-h-11 cursor-pointer gap-2 rounded-lg border px-3 py-2 text-sm",
                draft.method === m ? "border-accent bg-accent/10" : "border-border bg-card"
              )}
            >
              <input
                type="radio"
                name={`${ids}-method`}
                value={m}
                checked={draft.method === m}
                onChange={() => update({ method: m })}
                className="mt-1 h-4 w-4 shrink-0 accent-accent"
              />
              <span className="min-w-0">
                <span className="block font-medium text-text">{METHOD_LABEL[m]}</span>
                <span className="block text-xs text-sub">{METHOD_HINT[m]}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.method && (
          <p id={`${ids}-method-error`} role="alert" className="mt-1 text-xs text-danger">
            {errors.method}
          </p>
        )}
      </fieldset>
    </ItemForm>
  );
}
