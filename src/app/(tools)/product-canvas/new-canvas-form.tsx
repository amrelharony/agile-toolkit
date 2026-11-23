"use client";

/**
 * Starting a canvas: a name and a format. The format picker's cards (one
 * per format, each with when to use it) open this form with their format
 * chosen; the form keeps the choice changeable.
 */

import { Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BUILT_FORMATS, PRODUCT_FORMATS, productFormat } from "@/lib/product-canvas/formats";
import { TITLE_MAX, validateCanvasTitle } from "@/lib/product-canvas/model";
import type { ProductCanvasFormat } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { cn } from "@/lib/utils";

export interface NewCanvasDraft {
  title: string;
  format: ProductCanvasFormat | "";
}

export interface NewCanvasValues {
  title: string;
  format: ProductCanvasFormat;
}

/** A new canvas: a name within the cap, and a format this build offers. */
export function validateNewCanvas(
  draft: NewCanvasDraft
): Validation<NewCanvasValues, "title" | "format"> {
  const title = validateCanvasTitle(draft.title);
  const format = productFormat(draft.format);
  const errors: { title?: string; format?: string } = {};
  if (!title.ok) errors.title = title.errors.title;
  if (!format) errors.format = "Pick a format.";
  if (!title.ok || !format) return { ok: false, errors };
  return { ok: true, values: { title: title.values, format: format.id } };
}

export function NewCanvasForm({
  format,
  onCreate,
  onCancel,
}: {
  /** The format chosen to start with. */
  format: ProductCanvasFormat | "";
  onCreate: (values: NewCanvasValues) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<NewCanvasDraft, NewCanvasValues, "title" | "format">({
    initial: { title: "", format },
    validate: validateNewCanvas,
    onSave: onCreate,
  });
  const { draft, update, errors } = form;
  const chosen = productFormat(draft.format);
  return (
    <ItemForm
      form={form}
      submitLabel="Start the canvas"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      <fieldset
        className="space-y-1.5"
        aria-describedby={errors.format ? "pc-format-error" : undefined}
      >
        <legend className="text-sm font-medium text-text">Format</legend>
        <div className="flex flex-wrap gap-2">
          {BUILT_FORMATS.map((id) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={draft.format === id ? "toolkit" : "outline"}
              aria-pressed={draft.format === id}
              onClick={() => update({ format: id })}
            >
              {PRODUCT_FORMATS[id]?.name}
            </Button>
          ))}
        </div>
        {chosen && <p className="text-xs text-sub">{chosen.useWhen}</p>}
        {errors.format && (
          <p id="pc-format-error" role="alert" className="text-xs text-danger">
            {errors.format}
          </p>
        )}
      </fieldset>
      <Field label="Name" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            maxLength={TITLE_MAX}
            onChange={(e) => update({ title: e.target.value })}
            placeholder={chosen?.id === "value-proposition" ? "The customer group" : "Tapline"}
          />
        )}
      </Field>
    </ItemForm>
  );
}

/** The formats as cards: what each is for, how long it takes, and a button to start one. */
export function FormatPicker({
  onPick,
  className,
}: {
  onPick: (format: ProductCanvasFormat) => void;
  className?: string;
}) {
  return (
    <ul aria-label="Formats" className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {BUILT_FORMATS.map((id) => {
        const f = PRODUCT_FORMATS[id];
        if (!f) return null;
        return (
          <li key={id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
            <h3 className="font-display text-base text-text">{f.name}</h3>
            <p className="text-sm text-sub">{f.useWhen}</p>
            {f.time && <p className="text-xs text-sub">{f.time}</p>}
            <div className="mt-auto">
              <Button type="button" size="sm" variant="toolkit" onClick={() => onPick(id)}>
                <Plus aria-hidden="true" />
                Start a {f.name}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
