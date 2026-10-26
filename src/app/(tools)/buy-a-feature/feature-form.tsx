"use client";

import { useEffect } from "react";
import { Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { parseNumber, type Validation } from "@/lib/utils/form";
import { FEATURE_TITLE_MAX, PRICE_MAX, isPrice } from "@/lib/buy-a-feature/game";

export interface FeatureDraft {
  title: string;
  price: string;
}

export interface FeatureValues {
  title: string;
  price: number;
}

type Key = keyof FeatureDraft;

/**
 * A feature needs a title (up to 200 characters) and a whole price from 1:
 * a blank price used to become a free feature that could never be funded.
 */
export function validateFeature(d: FeatureDraft): Validation<FeatureValues, Key> {
  const errors: Partial<Record<Key, string>> = {};
  const title = d.title.trim();
  if (!title) errors.title = "Enter the feature.";
  else if (title.length > FEATURE_TITLE_MAX) {
    errors.title = `Keep it to ${FEATURE_TITLE_MAX} characters or fewer.`;
  }
  const price = parseNumber(d.price);
  if (price === undefined) errors.price = "Enter a price.";
  else if (!Number.isInteger(price) || price < 1) {
    errors.price = "Enter a whole number, 1 or more.";
  } else if (price > PRICE_MAX) {
    errors.price = `At most ${PRICE_MAX.toLocaleString("en-US")}.`;
  }
  if (Object.keys(errors).length > 0 || !isPrice(price)) return { ok: false, errors };
  return { ok: true, values: { title, price } };
}

function FeatureFields({
  draft,
  errors,
  update,
}: {
  draft: FeatureDraft;
  errors: Partial<Record<Key, string>>;
  update: (patch: Partial<FeatureDraft>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Field label="Feature" error={errors.title} className="sm:col-span-2">
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="e.g. Single sign-on"
          />
        )}
      </Field>
      <Field label="Price" hint="A whole number, e.g. its cost in team-days." error={errors.price}>
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={draft.price}
            onChange={(e) => update({ price: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

/** "Add feature": Enter submits, errors show inline, nothing is added until it's valid. */
export function AddFeatureForm({
  disabled,
  onAdd,
}: {
  disabled?: boolean;
  onAdd: (v: FeatureValues) => void;
}) {
  const form = useItemForm<FeatureDraft, FeatureValues, Key>({
    initial: { title: "", price: "" },
    validate: validateFeature,
    onSave: onAdd,
  });
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">Add a feature</legend>
      <ItemForm form={form} submitLabel="Add feature" submitIcon={<Plus aria-hidden="true" />}>
        <FeatureFields draft={form.draft} errors={form.errors} update={form.update} />
      </ItemForm>
    </fieldset>
  );
}

/**
 * A feature's title and price, edited in place: Save, Cancel or Escape.
 * Opening it moves focus to the title, since the Edit button that had it
 * is gone with the row it replaced.
 */
export function EditFeatureForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: FeatureDraft;
  onSave: (v: FeatureValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<FeatureDraft, FeatureValues, Key>({
    initial,
    validate: validateFeature,
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <FeatureFields draft={form.draft} errors={form.errors} update={form.update} />
    </ItemForm>
  );
}
