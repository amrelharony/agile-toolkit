"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useItemForm } from "@/components/shared/item-form";
import { cn } from "@/lib/utils";
import type { Validation } from "@/lib/utils/form";

interface NameDraft {
  name: string;
}

/** A trimmed name, or the field's message when it's blank or too long. */
export function validateName(
  draft: NameDraft,
  { required, max }: { required: string; max: number }
): Validation<{ name: string }, "name"> {
  const name = draft.name.trim();
  if (!name) return { ok: false, errors: { name: required } };
  if (name.length > max) {
    return { ok: false, errors: { name: `Keep it to ${max} characters or fewer.` } };
  }
  return { ok: true, values: { name } };
}

/**
 * "Add card" (or step, or slice) that opens a one-line field in place:
 * type the name, press Enter, and it's on the map; the field stays open
 * for the next one. Nothing is created until a name is typed, so the map
 * no longer fills with "New Story" placeholders to rename. Escape or Done
 * closes it and returns focus to the button.
 */
export function InlineAdd({
  triggerLabel,
  triggerAriaLabel,
  fieldLabel,
  placeholder,
  requiredMessage,
  max = 200,
  onAdd,
  className,
  triggerClassName,
}: {
  /** The button's visible text: "Add card". */
  triggerLabel: string;
  /** A fuller name when the button repeats: "Add card to Discover, MVP". */
  triggerAriaLabel?: string;
  /** The field's accessible name: "New story in Discover, MVP". */
  fieldLabel: string;
  placeholder?: string;
  requiredMessage: string;
  max?: number;
  onAdd: (name: string) => void;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const refocusTrigger = useRef(false);
  const form = useItemForm<NameDraft, { name: string }, "name">({
    initial: { name: "" },
    validate: (d) => validateName(d, { required: requiredMessage, max }),
    onSave: ({ name }) => onAdd(name),
  });
  const { formRef, reset } = form;

  useEffect(() => {
    if (open) formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    else if (refocusTrigger.current) {
      refocusTrigger.current = false;
      triggerRef.current?.focus();
    }
  }, [open, formRef]);

  const close = () => {
    refocusTrigger.current = true;
    reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        aria-label={triggerAriaLabel}
        onClick={() => setOpen(true)}
        className={cn(
          "gap-1 text-xs text-sub hover:bg-accent/5 hover:text-accent",
          triggerClassName
        )}
      >
        <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {triggerLabel}
      </Button>
    );
  }

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    close();
  };

  return (
    // Escape is a convenience on top of the visible Done button.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <form
      ref={formRef}
      onSubmit={form.submit}
      onKeyDown={onKeyDown}
      noValidate
      className={cn("space-y-1.5", className)}
    >
      <Field label={fieldLabel} hideLabel error={form.errors.name}>
        {(props) => (
          <Input
            {...props}
            value={form.draft.name}
            onChange={(e) => form.update({ name: e.target.value })}
            placeholder={placeholder}
            maxLength={max}
            className="h-8 bg-card text-sm"
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-1">
        <Button type="submit" size="sm" className="h-8 px-2.5">
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 px-2.5" onClick={close}>
          Done
        </Button>
      </div>
    </form>
  );
}
