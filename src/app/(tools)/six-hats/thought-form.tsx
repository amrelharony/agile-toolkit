"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import type { SixHatsHat } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { HATS, hatInfo } from "./hats";
import { THOUGHT_MAX, validateThought, type ThoughtDraft, type ThoughtField } from "./session";

export interface ThoughtValues {
  text: string;
  hat: SixHatsHat;
}

/**
 * Log a thought. During a round the hat being worn is picked already;
 * outside one, the hat stays unpicked until someone chooses it, so a
 * thought never lands under White by default. Enter logs it and
 * Shift+Enter starts a new line.
 */
export function ThoughtForm({
  currentHat,
  onAdd,
}: {
  currentHat: SixHatsHat | undefined;
  onAdd: (values: ThoughtValues) => void;
}) {
  const formState = useRef<ItemFormState<ThoughtDraft, ThoughtField> | null>(null);
  const form = useItemForm<ThoughtDraft, ThoughtValues, ThoughtField>({
    initial: () => ({ text: "", hat: currentHat ?? null }),
    validate: validateThought,
    onSave: (values) => {
      onAdd(values);
      // Ready for the next thought under the same hat.
      formState.current?.reset({ text: "", hat: values.hat });
    },
    resetOnSave: false,
  });
  formState.current = form;
  const { draft, update, errors } = form;

  // The round moved on: new thoughts go under the hat now being worn.
  useEffect(() => {
    if (currentHat) update({ hat: currentHat });
  }, [currentHat, update]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    form.submit();
  };

  const picked = draft.hat ? hatInfo(draft.hat) : null;

  return (
    <ItemForm
      form={form}
      submitLabel="Log thought"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <HatChoice value={draft.hat} error={errors.hat} onChange={(hat) => update({ hat })} />
      <Field
        label="Thought"
        error={errors.text}
        required
        hint={
          picked
            ? `${picked.name} hat: ${picked.hint} Enter logs it; Shift+Enter starts a new line.`
            : "Enter logs it; Shift+Enter starts a new line."
        }
      >
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={THOUGHT_MAX}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
            onKeyDown={onKeyDown}
            placeholder={
              currentHat ? `What does the ${hatInfo(currentHat).name} hat see?` : undefined
            }
          />
        )}
      </Field>
    </ItemForm>
  );
}

const HAT_OPTIONS: ToggleOption<SixHatsHat>[] = HATS.map((h) => ({
  value: h.id,
  label: (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", h.swatch)} aria-hidden="true" />
      <span className={h.text}>{h.name}</span>
      <span className="text-xs font-normal text-sub">{h.focus}</span>
    </span>
  ),
  ariaLabel: `${h.name} hat: ${h.focus}`,
  description: h.hint,
}));

/**
 * The six hats as one radio group: one is required, none is preselected
 * outside a round. Marked like a scale picker, so a failed save focuses it.
 */
function HatChoice({
  value,
  error,
  onChange,
}: {
  value: SixHatsHat | null;
  error?: string;
  onChange: (hat: SixHatsHat) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-scale-invalid={error ? "true" : undefined}>
      <span className="text-sm text-text" aria-hidden="true">
        Hat
        <span className="ml-0.5 text-danger">*</span>
      </span>
      <ToggleGroup
        label="Hat"
        size="sm"
        options={HAT_OPTIONS}
        value={value}
        onValueChange={onChange}
      />
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
