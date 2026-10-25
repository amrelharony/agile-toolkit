"use client";

/**
 * The team's limits for each KPI and the windows the numbers read, edited
 * as one draft: nothing is saved until every field passes the checks the
 * agent's set_thresholds runs too (lib/health-dashboard/settings), and the
 * first wrong field gets focus. Reset goes back to the defaults, with a
 * confirm and Undo.
 *
 * The draft follows the stored settings: when the agent's set_thresholds
 * or another device changes them, the form shows the new values, keeping
 * any unsaved edit on top (and saying so), so a later Save can't quietly
 * write the old set back over the other change.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Save } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { ResetButton } from "@/components/shared/reset-button";
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WINDOWS,
  HEALTH_KPI_IDS,
  KPI_DEFINITIONS,
  WINDOW_LIMITS,
  limitText,
  settingsDraft,
  settingsOf,
  validateThresholds,
  type HealthSettings,
  type HealthWindowKey,
  type SettingsDraft,
  type ThresholdField,
} from "@/lib/health-dashboard/settings";

const UNIT_HINT = { percent: "%", count: "items", days: "days" } as const;

const WINDOW_LABEL: Record<HealthWindowKey, { label: string; hint: string }> = {
  sprintWindow: {
    label: "Sprints predictability reads",
    hint: `The latest pointed sprints (${WINDOW_LIMITS.sprintWindow.min}–${WINDOW_LIMITS.sprintWindow.max}); default ${DEFAULT_WINDOWS.sprintWindow}.`,
  },
  blockerWindowDays: {
    label: "Days a standup blocker stays recent",
    hint: `Older unresolved blockers are listed, not counted; default ${DEFAULT_WINDOWS.blockerWindowDays}.`,
  },
  cycleWindowDays: {
    label: "Days of finished work for cycle time",
    hint: `Stories and cards finished in this many days; default ${DEFAULT_WINDOWS.cycleWindowDays}.`,
  },
};

/** Two typed values that read as the same number ("1" and "1.0"), or the same text. */
function sameValue(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  return x === y || (x !== "" && y !== "" && Number(x) === Number(y));
}

const FIELDS = (d: SettingsDraft) => Object.keys(d) as ThresholdField[];

function NumberInput({
  form,
  field,
  label,
  hint,
}: {
  form: ItemFormState<SettingsDraft, ThresholdField>;
  field: ThresholdField;
  label: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint} error={form.errors[field]} required>
      {(props) => (
        <Input
          {...props}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={form.draft[field]}
          onChange={(e) => form.update({ [field]: e.target.value } as Partial<SettingsDraft>)}
          className="font-data"
        />
      )}
    </Field>
  );
}

export function ThresholdsForm({
  settings,
  custom,
  onSave,
  onReset,
  onUndoReset,
}: {
  settings: HealthSettings;
  /** Whether anything differs from the defaults (Reset has something to do). */
  custom: boolean;
  onSave: (next: HealthSettings) => void;
  onReset: () => void;
  onUndoReset: () => void;
}) {
  const stored = useMemo(() => settingsDraft(settings), [settings]);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const form = useItemForm<SettingsDraft, HealthSettings, ThresholdField>({
    initial: () => stored,
    validate: validateThresholds,
    onSave: (values) => {
      setChangedElsewhere(false);
      onSave(values);
    },
    resetOnSave: false,
  });
  const { draft, reset, formRef } = form;

  // The stored settings the draft was last brought in line with.
  const base = useRef(stored);
  useEffect(() => {
    const before = base.current;
    if (FIELDS(stored).every((f) => sameValue(before[f], stored[f]))) return;
    base.current = stored;
    // Edits not saved yet: changed since `before` and not what is stored now
    // (after this form's own Save, the draft already matches).
    const pending = FIELDS(stored).filter(
      (f) => !sameValue(draft[f], before[f]) && !sameValue(draft[f], stored[f])
    );
    const next = { ...stored };
    for (const f of pending) next[f] = draft[f];
    reset(next);
    setChangedElsewhere(pending.length > 0);
  }, [stored, draft, reset]);

  // After a reset, focus goes to the first limit: the Reset button the
  // dialog would hand it back to is disabled by then (nothing to reset).
  const focusFirst = useRef(false);
  useEffect(() => {
    if (!focusFirst.current) return;
    focusFirst.current = false;
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  });

  const resetToDefaults = () => {
    const defaults = settingsDraft(settingsOf(null));
    base.current = defaults;
    reset(defaults);
    setChangedElsewhere(false);
    focusFirst.current = true;
    onReset();
  };

  return (
    <ItemForm
      form={form}
      submitLabel="Save thresholds"
      submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
      footer={
        <ResetButton
          label="Reset thresholds"
          title="Reset the thresholds and windows?"
          description="Every KPI goes back to the default limits, and the windows to 6 sprints, 7 days and 90 days."
          confirmLabel="Reset thresholds"
          doneLabel="Reset the thresholds"
          onReset={resetToDefaults}
          onUndo={onUndoReset}
          disabled={!custom}
        />
      }
    >
      {changedElsewhere && (
        <p
          role="status"
          className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-text"
        >
          The thresholds changed elsewhere (the agent or another device). The form shows them now,
          with your unsaved edits kept on top: Save to keep your edits, or change them back.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {HEALTH_KPI_IDS.map((id) => {
          const def = KPI_DEFINITIONS[id];
          const d = DEFAULT_THRESHOLDS[id];
          const word = def.higherIsBetter ? "from" : "up to";
          return (
            <fieldset key={id} className="min-w-0 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium text-text">{def.name}</legend>
              <p className="mb-2 text-xs text-sub">
                {def.higherIsBetter ? "Higher is better" : "Lower is better"} ({UNIT_HINT[def.unit]}
                ). Default: green {limitText(id, d.green)}, amber {limitText(id, d.amber)}.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <NumberInput form={form} field={`${id}.green`} label={`Green ${word}`} />
                <NumberInput form={form} field={`${id}.amber`} label={`Amber ${word}`} />
              </div>
            </fieldset>
          );
        })}
      </div>
      <fieldset className="min-w-0 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium text-text">Windows</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(Object.keys(WINDOW_LABEL) as HealthWindowKey[]).map((key) => (
            <NumberInput
              key={key}
              form={form}
              field={key}
              label={WINDOW_LABEL[key].label}
              hint={WINDOW_LABEL[key].hint}
            />
          ))}
        </div>
      </fieldset>
    </ItemForm>
  );
}
