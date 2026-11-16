"use client";

import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import {
  ROOT_CAUSE_METHODS,
  TOOL_TEXT_MAX,
  type RootCauseMethod,
} from "@/lib/stores/workspace-types";
import { ROOT_CAUSE_METHOD_LABEL, analysisDraftErrors } from "@/lib/root-cause/model";
import type { Validation } from "@/lib/utils/form";
import { cn } from "@/lib/utils";

export interface AnalysisDraft {
  title: string;
  problem: string;
  method: RootCauseMethod;
}

export interface NewAnalysisValues {
  title: string;
  problem: string;
  method: RootCauseMethod;
}

const EMPTY: AnalysisDraft = { title: "", problem: "", method: "five-whys" };

/** A new analysis's draft checked: a name for the problem, both within their caps. */
export function validateAnalysisDraft(
  draft: AnalysisDraft
): Validation<NewAnalysisValues, "title" | "problem"> {
  const errors = analysisDraftErrors(draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { title: draft.title.trim(), problem: draft.problem.trim(), method: draft.method },
  };
}

const METHOD_HINT: Record<RootCauseMethod, string> = {
  "five-whys": "Ask why, about five times, down one chain of causes.",
  fishbone: "Lay out many causes under people, process, tools and more, then count them.",
};

export function NewAnalysisForm({
  onCreate,
  onCancel,
}: {
  onCreate: (values: NewAnalysisValues) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm({ initial: EMPTY, validate: validateAnalysisDraft, onSave: onCreate });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Start the analysis"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
      className="space-y-3"
    >
      <Field label="The problem, in a few words" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            maxLength={TOOL_TEXT_MAX.short}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Releases rolled back the same day"
          />
        )}
      </Field>
      <Field
        label="What happened, as a fact"
        hint="Where, when and how often. No names and no blame."
        error={errors.problem}
      >
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.problem}
            maxLength={TOOL_TEXT_MAX.text}
            onChange={(e) => update({ problem: e.target.value })}
          />
        )}
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-text">Start with</legend>
        <div className="flex flex-wrap gap-2">
          {ROOT_CAUSE_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={draft.method === m}
              onClick={() => update({ method: m })}
              className={cn(
                "min-touch-coarse rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                draft.method === m
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border bg-card text-sub hover:text-text"
              )}
            >
              {ROOT_CAUSE_METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        <p className="text-xs text-sub">{METHOD_HINT[draft.method]}</p>
      </fieldset>
    </ItemForm>
  );
}
