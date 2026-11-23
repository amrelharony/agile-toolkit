"use client";

import { forwardRef, useId, useState } from "react";
import { BugPlay, ChevronDown } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import {
  EMPTY_BUG_DRAFT,
  validateBugDraft,
  type BugDraft,
  type BugValues,
} from "@/lib/bug-triage/model";

/**
 * The quick log: the bug in one line, and Enter logs it. "More details"
 * opens the steps, what was expected and what happened, where, the area and
 * who found it. The same form edits a bug's details (`initial`, with
 * Cancel). Nothing is saved until the title has words, and every field
 * holds the caps the agents' CRUD holds.
 */
export const LogForm = forwardRef<
  HTMLInputElement,
  {
    onSave: (values: BugValues) => void;
    /** A bug's details to edit; absent for a new bug. */
    initial?: BugDraft;
    onCancel?: () => void;
    /** Offer "Add to the team" for a name off the roster. */
    offerAddToRoster?: boolean;
  }
>(function LogForm({ onSave, initial, onCancel, offerAddToRoster = true }, ref) {
  const editing = initial !== undefined;
  const form = useItemForm<BugDraft, BugValues, keyof BugDraft>({
    initial: initial ?? EMPTY_BUG_DRAFT,
    validate: validateBugDraft,
    onSave,
    resetOnSave: !editing,
  });
  const { draft, update, errors } = form;
  const hasDetails =
    editing ||
    Object.keys(errors).some((k) => k !== "title") ||
    [draft.steps, draft.expected, draft.actual, draft.environment, draft.area].some(Boolean);
  const [open, setOpen] = useState(false);
  const showDetails = open || hasDetails;
  const detailsId = useId();

  return (
    <ItemForm
      form={form}
      submitLabel={editing ? "Save details" : "Log bug"}
      submitIcon={editing ? undefined : <BugPlay className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
      footer={
        editing ? undefined : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            aria-expanded={showDetails}
            aria-controls={detailsId}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown
              className={showDetails ? "h-4 w-4 rotate-180" : "h-4 w-4"}
              aria-hidden="true"
            />
            More details
          </Button>
        )
      }
    >
      <Field
        label="What's wrong"
        error={errors.title}
        required
        hint={editing ? undefined : "One line. Enter logs it."}
      >
        {(props) => (
          <Input
            {...props}
            ref={ref}
            value={draft.title}
            maxLength={TOOL_TEXT_MAX.short}
            enterKeyHint="done"
            autoComplete="off"
            onChange={(e) => update({ title: e.target.value })}
            placeholder="e.g. The receipt shows the wrong currency"
          />
        )}
      </Field>
      {showDetails && (
        <div id={detailsId} className="grid gap-3 sm:grid-cols-2">
          <Field label="Steps to make it happen" error={errors.steps} className="sm:col-span-2">
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={draft.steps}
                maxLength={TOOL_TEXT_MAX.text}
                onChange={(e) => update({ steps: e.target.value })}
              />
            )}
          </Field>
          <Field label="What you expected" error={errors.expected}>
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                value={draft.expected}
                maxLength={TOOL_TEXT_MAX.text}
                onChange={(e) => update({ expected: e.target.value })}
              />
            )}
          </Field>
          <Field label="What happened" error={errors.actual}>
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                value={draft.actual}
                maxLength={TOOL_TEXT_MAX.text}
                onChange={(e) => update({ actual: e.target.value })}
              />
            )}
          </Field>
          <Field label="Where" hint="A device, browser or environment" error={errors.environment}>
            {(props) => (
              <Input
                {...props}
                value={draft.environment}
                maxLength={TOOL_TEXT_MAX.short}
                autoComplete="off"
                onChange={(e) => update({ environment: e.target.value })}
              />
            )}
          </Field>
          <Field label="Area" hint="The part of the product" error={errors.area}>
            {(props) => (
              <Input
                {...props}
                value={draft.area}
                maxLength={TOOL_TEXT_MAX.short}
                autoComplete="off"
                onChange={(e) => update({ area: e.target.value })}
              />
            )}
          </Field>
          <PersonPicker
            label="Who found it"
            value={draft.reportedBy}
            onChange={(reportedBy) => update({ reportedBy })}
            error={errors.reportedBy}
            offerAddToRoster={offerAddToRoster}
            className="sm:col-span-2"
          />
        </div>
      )}
    </ItemForm>
  );
});

/** A bug's details as the form edits them. */
export function draftOf(bug: {
  title: string;
  steps?: string;
  expected?: string;
  actual?: string;
  environment?: string;
  area?: string;
  reportedBy?: string;
}): BugDraft {
  return {
    title: bug.title,
    steps: bug.steps ?? "",
    expected: bug.expected ?? "",
    actual: bug.actual ?? "",
    environment: bug.environment ?? "",
    area: bug.area ?? "",
    reportedBy: bug.reportedBy ?? "",
  };
}
