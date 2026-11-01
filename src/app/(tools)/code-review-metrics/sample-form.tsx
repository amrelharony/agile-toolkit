"use client";

import { Plus, Save } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  nowWallClock,
  sampleErrors,
  toWallClock,
  type SampleDraft,
  type SampleField,
} from "@/lib/quality/review";
import type { PrSample } from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";

/** Every field as typed: the form's inputs hold strings. */
export type SampleDraftText = Required<{ [K in keyof SampleDraft]: string }>;

export function emptySampleDraft(): SampleDraftText {
  return {
    prNumber: "",
    author: "",
    openedAt: "",
    firstReviewAt: "",
    mergedAt: "",
    reviewerCount: "",
    commentCount: "",
    linesChanged: "",
    description: "",
  };
}

/** A logged PR as a draft; its times as the datetime-local inputs take them. */
export function draftFromSample(s: PrSample): SampleDraftText {
  const time = (v: string | undefined) => (v ? (toWallClock(v) ?? v) : "");
  return {
    prNumber: s.prNumber ?? "",
    author: s.author,
    openedAt: time(s.openedAt),
    firstReviewAt: time(s.firstReviewAt),
    mergedAt: time(s.mergedAt),
    reviewerCount: String(s.reviewerCount),
    commentCount: String(s.commentCount),
    linesChanged: String(s.linesChanged),
    description: s.description ?? "",
  };
}

/**
 * Check a PR's draft: sampleErrors (lib/quality/review: the author, the
 * times in order and not in the future, whole counts, and a PR number
 * another logged PR holds, which the agent's add_sample and update_sample
 * refuse too).
 */
export function validateSample(
  draft: SampleDraftText,
  now: string,
  samples: readonly PrSample[],
  editingId?: string
): Validation<SampleDraftText, SampleField> {
  const errors: FormErrors<SampleField> = sampleErrors(draft, now, {
    existing: samples,
    editingId,
  });
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values: draft };
}

const COUNT_FIELDS = [
  ["reviewerCount", "Reviewers"],
  ["commentCount", "Review comments"],
  ["linesChanged", "Lines changed"],
] as const;

/** Log a pull request (no `editing`), or edit one in place. */
export function SampleForm({
  samples,
  editing,
  onSave,
  onCancel,
}: {
  samples: readonly PrSample[];
  editing?: PrSample;
  onSave: (draft: SampleDraftText) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<SampleDraftText, SampleDraftText, SampleField>({
    initial: () => (editing ? draftFromSample(editing) : emptySampleDraft()),
    validate: (d) => validateSample(d, nowWallClock(), samples, editing?.id),
    onSave: (values) => onSave(values),
    resetOnSave: !editing,
  });
  const { draft, update, errors } = form;
  const max = nowWallClock();
  const time = (
    field: "openedAt" | "firstReviewAt" | "mergedAt",
    label: string,
    hint: string,
    required = false
  ) => (
    <Field label={label} hint={hint} error={errors[field]} required={required}>
      {(props) => (
        <Input
          {...props}
          type="datetime-local"
          max={max}
          value={draft[field]}
          onChange={(e) => update({ [field]: e.target.value } as Partial<SampleDraftText>)}
          className="font-data"
        />
      )}
    </Field>
  );
  return (
    <ItemForm
      form={form}
      submitLabel={editing ? "Save" : "Add PR"}
      submitIcon={editing ? <Save aria-hidden="true" /> : <Plus aria-hidden="true" />}
      onCancel={onCancel}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="PR number (optional)" error={errors.prNumber}>
          {(props) => (
            <Input
              {...props}
              value={draft.prNumber}
              onChange={(e) => update({ prNumber: e.target.value })}
              placeholder="#1234"
              className="font-data"
            />
          )}
        </Field>
        <PersonPicker
          label="Author"
          value={draft.author}
          onChange={(author) => update({ author })}
          error={errors.author}
          required
        />
        {time("openedAt", "Opened", "When the PR was opened for review", true)}
        {time("firstReviewAt", "First review (optional)", "The first review or comment")}
        {time("mergedAt", "Merged (optional)", "Blank while it is open")}
        {COUNT_FIELDS.map(([field, label]) => (
          <Field key={field} label={label} error={errors[field]} required>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                value={draft[field]}
                onChange={(e) => update({ [field]: e.target.value } as Partial<SampleDraftText>)}
                className="font-data"
              />
            )}
          </Field>
        ))}
        <Field
          label="Description (optional)"
          error={errors.description}
          className="sm:col-span-2 lg:col-span-4"
        >
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Notes, a link to the PR"
              className="text-sm"
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
