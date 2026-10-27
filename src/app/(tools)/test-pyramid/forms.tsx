"use client";

import { Camera, Save, Timer } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  PYRAMID_NOTE_MAX,
  TEST_LAYERS,
  TEST_LAYER_LABEL,
  countsErrors,
  runtimeErrors,
  snapshotDayError,
  type TestLayer,
} from "@/lib/quality/pyramid";
import type { TestLayerRuntime, TestPyramid } from "@/lib/stores/workspace-types";
import { parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";

/** The description's bound: the agent's set_counts takes the same. */
export const PYRAMID_DESCRIPTION_MAX = 2000;

const LAYER_HINT: Record<TestLayer, string> = {
  unit: "Fast, isolated, in-process.",
  integration: "Several components or services together.",
  e2e: "Full stack, a real browser or API.",
};

/* ── Counts ────────────────────────────────────────────────────────── */

export interface CountsDraft {
  unit: string;
  integration: string;
  e2e: string;
  description: string;
}

export interface CountsValues {
  unit: number;
  integration: number;
  e2e: number;
  description?: string;
}

type CountsField = TestLayer | "description";

export function countsDraftOf(doc: TestPyramid | null): CountsDraft {
  return {
    unit: doc ? String(doc.unit) : "",
    integration: doc ? String(doc.integration) : "",
    e2e: doc ? String(doc.e2e) : "",
    description: doc?.description ?? "",
  };
}

/** Every layer needs a whole count (countsErrors): a layer left blank is never saved as 0. */
export function validateCounts(draft: CountsDraft): Validation<CountsValues, CountsField> {
  const errors: FormErrors<CountsField> = countsErrors(draft);
  if (draft.description.trim().length > PYRAMID_DESCRIPTION_MAX) {
    errors.description = `Keep the description to ${PYRAMID_DESCRIPTION_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const description = draft.description.trim();
  return {
    ok: true,
    values: {
      unit: Number(draft.unit),
      integration: Number(draft.integration),
      e2e: Number(draft.e2e),
      ...(description ? { description } : {}),
    },
  };
}

/** The counts of each layer, saved together on "Save counts" (never on each blur). */
export function CountsForm({
  doc,
  onSave,
}: {
  doc: TestPyramid | null;
  onSave: (values: CountsValues) => void;
}) {
  const form = useItemForm<CountsDraft, CountsValues, CountsField>({
    initial: () => countsDraftOf(doc),
    validate: validateCounts,
    onSave,
    resetOnSave: false,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm form={form} submitLabel="Save counts" submitIcon={<Save aria-hidden="true" />}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TEST_LAYERS.map((l) => (
          <Field
            key={l}
            label={`${TEST_LAYER_LABEL[l]} tests`}
            hint={LAYER_HINT[l]}
            error={errors[l]}
            required
          >
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                value={draft[l]}
                onChange={(e) => update({ [l]: e.target.value } as Partial<CountsDraft>)}
                className="font-data"
              />
            )}
          </Field>
        ))}
      </div>
      <Field label="Description (optional)" hint="Repo, framework notes" error={errors.description}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            className="text-sm"
          />
        )}
      </Field>
    </ItemForm>
  );
}

/* ── Run time ──────────────────────────────────────────────────────── */

export type RuntimeDraft = Record<TestLayer, string>;

export function runtimeDraftOf(runtime: TestLayerRuntime | undefined): RuntimeDraft {
  const out = { unit: "", integration: "", e2e: "" };
  for (const l of TEST_LAYERS) if (typeof runtime?.[l] === "number") out[l] = String(runtime[l]);
  return out;
}

/** Minutes are optional per layer (a blank clears that layer's), 0 or more when typed. */
export function validateRuntime(draft: RuntimeDraft): Validation<TestLayerRuntime, TestLayer> {
  const errors = runtimeErrors(draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const runtime: TestLayerRuntime = {};
  for (const l of TEST_LAYERS) {
    const n = parseNumber(draft[l]);
    if (n !== undefined) runtime[l] = Math.round(n * 100) / 100;
  }
  return { ok: true, values: runtime };
}

/** How long each layer's suite takes, for weighing the layers by run time. */
export function RuntimeForm({
  runtime,
  onSave,
}: {
  runtime: TestLayerRuntime | undefined;
  onSave: (runtime: TestLayerRuntime) => void;
}) {
  const form = useItemForm<RuntimeDraft, TestLayerRuntime, TestLayer>({
    initial: () => runtimeDraftOf(runtime),
    validate: validateRuntime,
    onSave,
    resetOnSave: false,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm form={form} submitLabel="Save minutes" submitIcon={<Timer aria-hidden="true" />}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TEST_LAYERS.map((l) => (
          <Field
            key={l}
            label={`${TEST_LAYER_LABEL[l]} minutes`}
            hint="CI wall-clock for the whole layer"
            error={errors[l]}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={draft[l]}
                onChange={(e) => update({ [l]: e.target.value } as Partial<RuntimeDraft>)}
                className="font-data"
              />
            )}
          </Field>
        ))}
      </div>
    </ItemForm>
  );
}

/* ── Snapshot ──────────────────────────────────────────────────────── */

export interface SnapshotDraft {
  takenOn: string;
  note: string;
}

export function validateSnapshot(
  draft: SnapshotDraft,
  today: string
): Validation<SnapshotDraft, "takenOn" | "note"> {
  const errors: FormErrors<"takenOn" | "note"> = {};
  const day = snapshotDayError(draft.takenOn, today);
  if (day) errors.takenOn = day;
  if (draft.note.trim().length > PYRAMID_NOTE_MAX) {
    errors.note = `Keep the note to ${PYRAMID_NOTE_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { takenOn: draft.takenOn.trim(), note: draft.note.trim() } };
}

/** Keep today's counts as a dated snapshot; the day can be backdated, never after today. */
export function SnapshotForm({
  today,
  onSave,
}: {
  today: string;
  onSave: (values: SnapshotDraft) => void;
}) {
  const form = useItemForm<SnapshotDraft, SnapshotDraft, "takenOn" | "note">({
    initial: () => ({ takenOn: today, note: "" }),
    validate: (d) => validateSnapshot(d, today),
    onSave,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm form={form} submitLabel="Take snapshot" submitIcon={<Camera aria-hidden="true" />}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="Counts as of" error={errors.takenOn} required>
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={draft.takenOn}
              onChange={(e) => update({ takenOn: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Note (optional)"
          hint="A release, a cleanup, a new framework"
          error={errors.note}
        >
          {(props) => (
            <Input
              {...props}
              value={draft.note}
              onChange={(e) => update({ note: e.target.value })}
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
