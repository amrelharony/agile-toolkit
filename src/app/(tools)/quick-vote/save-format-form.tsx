"use client";

/**
 * "Save as my format": keep the round as it is set up (format, question,
 * answers) under a name, so it starts with one tap next time. The name is
 * checked first: not blank, not one already used, and only a round that
 * can run is saved.
 */

import { useState } from "react";
import { Save } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cleanLine } from "@/lib/quick-vote/draft";
import { MAX_CUSTOM_PRESETS, PRESET_NAME_MAX } from "@/lib/quick-vote/state";
import type { Validation } from "@/lib/utils/form";

/** A format's name, checked against the names already saved. */
export function validateFormatName(
  draft: { name: string },
  ctx: { taken: readonly string[]; roundProblem: string | null; full: boolean }
): Validation<{ name: string }, "name"> {
  const name = cleanLine(draft.name, PRESET_NAME_MAX);
  if (!name) return { ok: false, errors: { name: "Give the format a name." } };
  if (ctx.full) {
    return {
      ok: false,
      errors: { name: `You can keep ${MAX_CUSTOM_PRESETS} formats. Delete one first.` },
    };
  }
  if (ctx.taken.some((t) => t.toLowerCase() === name.toLowerCase())) {
    return { ok: false, errors: { name: `You already have a format called “${name}”.` } };
  }
  if (ctx.roundProblem) {
    return { ok: false, errors: { name: `Finish the round first: ${ctx.roundProblem}` } };
  }
  return { ok: true, values: { name } };
}

export function SaveFormatForm({
  taken,
  roundProblem,
  full,
  disabled,
  onSave,
}: {
  taken: readonly string[];
  roundProblem: string | null;
  full: boolean;
  disabled: boolean;
  onSave: (name: string) => void;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const form = useItemForm({
    initial: { name: "" },
    validate: (d) => validateFormatName(d, { taken, roundProblem, full }),
    onSave: ({ name }) => {
      onSave(name);
      setSaved(name);
    },
  });
  return (
    <ItemForm form={form} submitLabel="Save as my format" submitIcon={<Save aria-hidden="true" />}>
      <Field
        label="Name for this format"
        hint="It starts with your question and answers next time."
        error={form.errors.name}
      >
        {(props) => (
          <Input
            {...props}
            value={form.draft.name}
            maxLength={PRESET_NAME_MAX}
            disabled={disabled}
            onChange={(e) => {
              setSaved(null);
              form.update({ name: e.target.value });
            }}
          />
        )}
      </Field>
      {/* Announced by the page (a live region mounted with its text often isn't read). */}
      {saved && <p className="text-xs text-success">Saved “{saved}” under Your formats.</p>}
    </ItemForm>
  );
}
