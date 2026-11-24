"use client";

/**
 * Starting a canvas: a name and a format. The format picker's cards (one
 * per format, each with when to use it) open this form with their format
 * chosen; the form keeps the choice changeable.
 *
 * An idea is logged instead: the idea in a line, who asked (optional) and
 * where it came from. While the idea is typed, up to three open ideas that
 * look like it show under it, so a repeat can be counted on the idea that
 * is already there ("Asked again") rather than logged twice. The inbox's
 * quick capture is this form with its format fixed.
 */

import { Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  BUILT_FORMATS,
  PRODUCT_FORMATS,
  productFormat,
  startLabelOf,
} from "@/lib/product-canvas/formats";
import {
  IDEA_SOURCE_LABEL,
  REQUESTER_MAX,
  likelyDuplicates,
  type IdeaLike,
} from "@/lib/product-canvas/fields";
import { TITLE_MAX, validateCanvasTitle, validateIdea } from "@/lib/product-canvas/model";
import {
  PRODUCT_IDEA_SOURCES,
  type ProductCanvasFormat,
  type ProductIdeaSource,
} from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { cn } from "@/lib/utils";
import { SELECT_CLASS } from "./select-class";

export interface NewCanvasDraft {
  title: string;
  format: ProductCanvasFormat | "";
  /** An idea's: who asked. */
  requester?: string;
  /** An idea's: where it came from. */
  source?: ProductIdeaSource;
}

export interface NewCanvasValues {
  title: string;
  format: ProductCanvasFormat;
  /** An idea's, when named. */
  requester?: string;
  /** An idea's. */
  source?: ProductIdeaSource;
}

/** Where a typed idea comes from unless the person picks another: most requests do. */
const DEFAULT_SOURCE: ProductIdeaSource = "customer";

/** A new canvas: a name within the cap, and a format this build offers; an idea, its own words. */
export function validateNewCanvas(
  draft: NewCanvasDraft
): Validation<NewCanvasValues, "title" | "format" | "requester"> {
  const format = productFormat(draft.format);
  if (format?.id === "idea") {
    const v = validateIdea({ title: draft.title, requester: draft.requester ?? "" });
    if (!v.ok) {
      const errors: { title?: string; requester?: string } = {};
      if (v.errors.title) errors.title = v.errors.title;
      if (v.errors.requester) errors.requester = v.errors.requester;
      return { ok: false, errors };
    }
    return {
      ok: true,
      values: {
        title: v.values.title,
        format: "idea",
        ...(v.values.requester ? { requester: v.values.requester } : {}),
        source: draft.source ?? DEFAULT_SOURCE,
      },
    };
  }
  const title = validateCanvasTitle(draft.title);
  const errors: { title?: string; format?: string } = {};
  if (!title.ok) errors.title = title.errors.title;
  if (!format) errors.format = "Pick a format.";
  if (!title.ok || !format) return { ok: false, errors };
  return { ok: true, values: { title: title.values, format: format.id } };
}

const PLACEHOLDER: Partial<Record<ProductCanvasFormat, string>> = {
  "value-proposition": "The customer group",
  idea: "Split a bill between two cards",
  "business-case": "Card-machine-free shops",
  "shape-up": "Refund from the phone",
};

export function NewCanvasForm({
  format,
  onCreate,
  onCancel,
  lockFormat = false,
  ideas = [],
  onOpenIdea,
}: {
  /** The format chosen to start with. */
  format: ProductCanvasFormat | "";
  onCreate: (values: NewCanvasValues) => void;
  onCancel?: () => void;
  /** The inbox's quick capture: the format is fixed, so no format buttons. */
  lockFormat?: boolean;
  /** The inbox's ideas (the team's), for the look-alikes shown while an idea is typed. */
  ideas?: readonly IdeaLike[];
  /** Open an idea that looks like the one typed. */
  onOpenIdea?: (id: string) => void;
}) {
  const form = useItemForm<NewCanvasDraft, NewCanvasValues, "title" | "format" | "requester">({
    initial: { title: "", format, requester: "", source: DEFAULT_SOURCE },
    validate: validateNewCanvas,
    onSave: onCreate,
  });
  const { draft, update, errors } = form;
  const chosen = productFormat(draft.format);
  const idea = chosen?.id === "idea";
  const similar = idea ? likelyDuplicates(draft.title, ideas) : [];
  return (
    <ItemForm
      form={form}
      submitLabel={idea ? "Log the idea" : "Start the canvas"}
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      {!lockFormat && (
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
      )}
      <Field label={idea ? "The idea" : "Name"} error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            maxLength={TITLE_MAX}
            onChange={(e) => update({ title: e.target.value })}
            placeholder={(chosen && PLACEHOLDER[chosen.id]) ?? "Tapline"}
          />
        )}
      </Field>
      {similar.length > 0 && (
        <div role="status" className="space-y-1.5 rounded-md border border-border p-2">
          <p className="text-xs text-sub">
            Already in the inbox? Open it and count the ask there with Asked again.
          </p>
          <ul aria-label="Ideas that look like it" className="space-y-1">
            {similar.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm text-text">
                <span className="min-w-0 flex-1 break-words">{s.title}</span>
                {onOpenIdea && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Open “${s.title}”`}
                    onClick={() => onOpenIdea(s.id)}
                  >
                    Open
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {idea && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who asked" hint="A role or a name: optional." error={errors.requester}>
            {(props) => (
              <Input
                {...props}
                value={draft.requester ?? ""}
                maxLength={REQUESTER_MAX}
                onChange={(e) => update({ requester: e.target.value })}
                placeholder="Market organiser"
              />
            )}
          </Field>
          <Field label="Where it came from">
            {(props) => (
              <select
                {...props}
                className={SELECT_CLASS}
                value={draft.source ?? DEFAULT_SOURCE}
                onChange={(e) => update({ source: e.target.value as ProductIdeaSource })}
              >
                {PRODUCT_IDEA_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {IDEA_SOURCE_LABEL[s]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      )}
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
                {startLabelOf(f)}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
