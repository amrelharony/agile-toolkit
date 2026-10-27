"use client";

import { Plus, Save } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FLAKY_DESCRIPTION_MAX,
  FLAKY_OWNER_MAX,
  FLAKY_SUITE_MAX,
  flakyTestErrors,
  hasRunCounts,
  type FlakyField,
} from "@/lib/quality/flaky";
import type { FlakyTest } from "@/lib/stores/workspace-types";
import { type FormErrors, type Validation } from "@/lib/utils/form";

export interface TestDraft {
  name: string;
  suite: string;
  owner: string;
  failures: string;
  runs: string;
  /** "" on a new test means today; on an edit, the stored day stays. */
  firstSeenAt: string;
  description: string;
}

export type TestField = FlakyField | "suite" | "owner" | "description";

export interface TestValues {
  name: string;
  suite?: string;
  owner?: string;
  /** Absent only when an edited legacy row (rate only) still has no run counts. */
  failures?: number;
  runs?: number;
  firstSeenAt: string;
  description?: string;
}

export function emptyTestDraft(): TestDraft {
  return {
    name: "",
    suite: "",
    owner: "",
    failures: "",
    runs: "",
    firstSeenAt: "",
    description: "",
  };
}

export function draftFromTest(t: FlakyTest): TestDraft {
  return {
    name: t.name,
    suite: t.suite ?? "",
    owner: t.owner ?? "",
    failures: hasRunCounts(t) ? String(t.failures) : "",
    runs: hasRunCounts(t) ? String(t.runs) : "",
    firstSeenAt: t.firstSeenAt,
    description: t.description ?? "",
  };
}

/**
 * Check a test's draft (flakyTestErrors: a name, failures of runs, a
 * first-seen day not after today nor after the test's quarantine or fix).
 * A row from before Phase 8 holds only a rate: editing it may leave both
 * counts blank, and it keeps its rate, so fixing a typo in its name doesn't
 * demand numbers nobody has.
 */
export function validateTest(
  draft: TestDraft,
  today: string,
  editing?: FlakyTest
): Validation<TestValues, TestField> {
  const errors: FormErrors<TestField> = flakyTestErrors(
    {
      ...draft,
      quarantinedAt: editing?.quarantinedAt ?? null,
      fixedAt: editing?.fixedAt ?? null,
    },
    today
  );
  const keepsLegacyRate =
    editing !== undefined &&
    !hasRunCounts(editing) &&
    draft.failures.trim() === "" &&
    draft.runs.trim() === "";
  if (keepsLegacyRate) {
    delete errors.failures;
    delete errors.runs;
  }
  if (draft.suite.trim().length > FLAKY_SUITE_MAX) {
    errors.suite = `Keep the suite to ${FLAKY_SUITE_MAX} characters.`;
  }
  if (draft.owner.trim().length > FLAKY_OWNER_MAX) {
    errors.owner = `Keep the owner to ${FLAKY_OWNER_MAX} characters.`;
  }
  if (draft.description.trim().length > FLAKY_DESCRIPTION_MAX) {
    errors.description = `Keep the description to ${FLAKY_DESCRIPTION_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const opt = (v: string) => v.trim() || undefined;
  const firstSeen = draft.firstSeenAt.trim();
  return {
    ok: true,
    values: {
      name: draft.name.trim(),
      ...(opt(draft.suite) ? { suite: opt(draft.suite) } : {}),
      ...(opt(draft.owner) ? { owner: opt(draft.owner) } : {}),
      ...(keepsLegacyRate ? {} : { failures: Number(draft.failures), runs: Number(draft.runs) }),
      firstSeenAt: firstSeen || editing?.firstSeenAt || today,
      ...(opt(draft.description) ? { description: opt(draft.description) } : {}),
    },
  };
}

/** Log a flaky test (no `editing`), or edit one in place. */
export function TestForm({
  today,
  editing,
  onSave,
  onCancel,
}: {
  today: string;
  editing?: FlakyTest;
  onSave: (values: TestValues) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<TestDraft, TestValues, TestField>({
    initial: () => (editing ? draftFromTest(editing) : emptyTestDraft()),
    validate: (d) => validateTest(d, today, editing),
    onSave: (values) => onSave(values),
    resetOnSave: !editing,
  });
  const { draft, update, errors } = form;
  const legacy = editing !== undefined && !hasRunCounts(editing);
  return (
    <ItemForm
      form={form}
      submitLabel={editing ? "Save" : "Add test"}
      submitIcon={editing ? <Save aria-hidden="true" /> : <Plus aria-hidden="true" />}
      onCancel={onCancel}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Test name" error={errors.name} required className="sm:col-span-2">
          {(props) => (
            <Input
              {...props}
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="UserService › signs the user in"
            />
          )}
        </Field>
        <Field label="Suite (optional)" error={errors.suite}>
          {(props) => (
            <Input
              {...props}
              value={draft.suite}
              onChange={(e) => update({ suite: e.target.value })}
              placeholder="auth.spec.ts"
              className="font-data"
            />
          )}
        </Field>
        <PersonPicker
          label="Owner (optional)"
          value={draft.owner}
          onChange={(owner) => update({ owner })}
          error={errors.owner}
        />
        <Field
          label="Failed runs"
          hint={
            legacy ? "Blank keeps the rate logged before run counts" : "In the window you counted"
          }
          error={errors.failures}
          required={!legacy}
        >
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              value={draft.failures}
              onChange={(e) => update({ failures: e.target.value })}
              className="font-data"
            />
          )}
        </Field>
        <Field
          label="Runs"
          hint="Every run of the test, passed or failed"
          error={errors.runs}
          required={!legacy}
        >
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              value={draft.runs}
              onChange={(e) => update({ runs: e.target.value })}
              className="font-data"
            />
          )}
        </Field>
        <Field
          label="First seen"
          hint={editing ? undefined : "Blank means today"}
          error={errors.firstSeenAt}
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={draft.firstSeenAt}
              onChange={(e) => update({ firstSeenAt: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Description (optional)"
          error={errors.description}
          className="sm:col-span-2 lg:col-span-1"
        >
          {(props) => (
            <Textarea
              {...props}
              rows={1}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="What seems to trigger it, links to runs"
              className="text-sm"
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
