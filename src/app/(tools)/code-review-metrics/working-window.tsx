"use client";

import { Clock } from "lucide-react";
import { ItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { workingWindowError } from "@/lib/quality/review";
import type { CodeReviewWorkingWindow } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
// The pyramid's forms share the need: edit a stored value in place, and stay mounted.
import { useStoredItemForm } from "@/app/(tools)/test-pyramid/use-stored-form";

interface WindowDraft {
  start: string;
  end: string;
}

/** Both times as "HH:MM", the end after the start (workingWindowError); the error sits on the end. */
export function validateWindow(
  draft: WindowDraft
): Validation<CodeReviewWorkingWindow, "start" | "end"> {
  const error = workingWindowError(draft.start, draft.end);
  if (!error) return { ok: true, values: { start: draft.start, end: draft.end } };
  return { ok: false, errors: draft.start ? { end: error } : { start: error } };
}

/**
 * The hours of a working day that count, or whole working days: there is
 * no default window (a 09:00–17:00 the team never chose would shorten
 * every time on screen).
 */
export function WorkingWindowForm({
  window,
  onSave,
  onClear,
}: {
  window: CodeReviewWorkingWindow | undefined;
  onSave: (window: CodeReviewWorkingWindow) => void;
  onClear: () => void;
}) {
  // Stays mounted across a save (its own, an agent's), so focus stays put.
  const form = useStoredItemForm<WindowDraft, CodeReviewWorkingWindow, "start" | "end">(
    { start: window?.start ?? "", end: window?.end ?? "" },
    { validate: validateWindow, onSave }
  );
  const { draft, update, errors, reset, formRef } = form;
  const countWholeDays = () => {
    reset({ start: "", end: "" });
    onClear();
    // The button goes with the window it clears: focus the first time instead.
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("input")?.focus());
  };
  return (
    <ItemForm
      form={form}
      submitLabel="Save working hours"
      submitIcon={<Clock aria-hidden="true" />}
      footer={
        window ? (
          <Button type="button" variant="ghost" onClick={countWholeDays}>
            Count whole days instead
          </Button>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
        <Field label="Day starts" error={errors.start}>
          {(props) => (
            <Input
              {...props}
              type="time"
              value={draft.start}
              onChange={(e) => update({ start: e.target.value })}
            />
          )}
        </Field>
        <Field label="Day ends" error={errors.end}>
          {(props) => (
            <Input
              {...props}
              type="time"
              value={draft.end}
              onChange={(e) => update({ end: e.target.value })}
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
