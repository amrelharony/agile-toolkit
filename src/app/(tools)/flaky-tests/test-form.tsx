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
  firstSeenOrderError,
  flakyDayError,
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
  /** The status day an edit can backdate (statusDayField); "" keeps the stored one. */
  quarantinedAt: string;
  fixedAt: string;
  description: string;
}

export type TestField = FlakyField | "suite" | "owner" | "description" | StatusDayField;

export interface TestValues {
  name: string;
  suite?: string;
  owner?: string;
  /** Absent only when an edited legacy row (rate only) still has no run counts. */
  failures?: number;
  runs?: number;
  firstSeenAt: string;
  /** Only for a quarantined (or fixed) test being edited. */
  quarantinedAt?: string;
  fixedAt?: string;
  description?: string;
}

export type StatusDayField = "quarantinedAt" | "fixedAt";

/**
 * The status day an edit of `t` can set: when a quarantined test went in,
 * or when a fixed one was fixed. A status change stamps today, so this is
 * where triage logged after the fact is backdated (the agent's add_test and
 * update_test take the same days). Null for an active test.
 */
export function statusDayField(t: FlakyTest | undefined): StatusDayField | null {
  if (t?.status === "quarantined") return "quarantinedAt";
  if (t?.status === "fixed") return "fixedAt";
  return null;
}

export function emptyTestDraft(): TestDraft {
  return {
    name: "",
    suite: "",
    owner: "",
    failures: "",
    runs: "",
    firstSeenAt: "",
    quarantinedAt: "",
    fixedAt: "",
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
    quarantinedAt: t.quarantinedAt ?? "",
    fixedAt: t.fixedAt ?? "",
    description: t.description ?? "",
  };
}

/**
 * Check a test's draft (flakyTestErrors: a name, failures of runs, a
 * first-seen day not after today nor after the test's quarantine or fix).
 * A row from before Phase 8 holds only a rate: editing it may leave both
 * counts blank, and it keeps its rate, so fixing a typo in its name doesn't
 * demand numbers nobody has. A quarantined or fixed test's status day
 * (statusDayField) can be backdated: never after today, never before the
 * day the test was first seen; blank keeps the stored day (or none, on a
 * legacy row whose quarantine date is unknown).
 */
export function validateTest(
  draft: TestDraft,
  today: string,
  editing?: FlakyTest
): Validation<TestValues, TestField> {
  const dayField = statusDayField(editing);
  const typedDay = dayField ? draft[dayField].trim() : "";
  // A stored day left as it is isn't judged against today again: an agent
  // on a server ahead of the person may have stored their tomorrow.
  const dayError =
    typedDay && dayField && typedDay !== editing?.[dayField]
      ? flakyDayError(typedDay, today)
      : null;
  // The order checks run on the status day as edited, the other as stored.
  const days = { quarantinedAt: editing?.quarantinedAt ?? null, fixedAt: editing?.fixedAt ?? null };
  if (dayField && typedDay && !dayError) days[dayField] = typedDay;
  const legacy = editing !== undefined && !hasRunCounts(editing);
  const errors: FormErrors<TestField> = flakyTestErrors({ ...draft, ...days }, today, {
    allowBlankCounts: legacy,
    keepFirstSeenAt: editing?.firstSeenAt,
  });
  if (dayField && dayError) errors[dayField] = dayError;
  else if (dayField && typedDay && typedDay !== editing?.[dayField]) {
    const firstSeen = draft.firstSeenAt.trim() || editing?.firstSeenAt || "";
    if (firstSeen && typedDay < firstSeen) {
      // The clash is with the day just typed: say so there, not on First seen.
      errors[dayField] = `It can't come before the day it was first seen (${firstSeen}).`;
      if (errors.firstSeenAt === firstSeenOrderError(firstSeen, days)) delete errors.firstSeenAt;
    }
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
  const statusDay = dayField ? typedDay || editing?.[dayField] : undefined;
  const keepsLegacyRate = legacy && draft.failures.trim() === "" && draft.runs.trim() === "";
  return {
    ok: true,
    values: {
      name: draft.name.trim(),
      ...(opt(draft.suite) ? { suite: opt(draft.suite) } : {}),
      ...(opt(draft.owner) ? { owner: opt(draft.owner) } : {}),
      ...(keepsLegacyRate ? {} : { failures: Number(draft.failures), runs: Number(draft.runs) }),
      firstSeenAt: firstSeen || editing?.firstSeenAt || today,
      ...(dayField === "quarantinedAt" && statusDay ? { quarantinedAt: statusDay } : {}),
      ...(dayField === "fixedAt" && statusDay ? { fixedAt: statusDay } : {}),
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
  const dayField = statusDayField(editing);
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
        {dayField && (
          <Field
            label={dayField === "quarantinedAt" ? "Quarantined since" : "Fixed on"}
            hint={
              editing?.[dayField]
                ? "Backdate it if it happened before it was logged"
                : "Not recorded: blank leaves it unknown"
            }
            error={errors[dayField]}
          >
            {(props) => (
              <Input
                {...props}
                type="date"
                min={draft.firstSeenAt || undefined}
                max={today}
                value={draft[dayField]}
                onChange={(e) => update({ [dayField]: e.target.value } as Partial<TestDraft>)}
              />
            )}
          </Field>
        )}
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
