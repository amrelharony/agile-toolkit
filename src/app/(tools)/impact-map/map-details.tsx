"use client";

/**
 * A map's name and due day, edited in a small form under the map's
 * heading. Nothing is saved blank; Escape or Cancel closes it.
 */

import { useEffect } from "react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { StrategyMap } from "@/lib/stores/workspace-types";
import { MAP_TITLE_MAX } from "@/lib/strategy-map/model";
import { validateMapDetails, type MapDetailsDraft, type MapDetailsField } from "./form";

export function MapDetailsForm({
  map,
  onSave,
  onCancel,
}: {
  map: StrategyMap;
  onSave: (title: string, targetDate: string) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<
    MapDetailsDraft,
    { title: string; targetDate?: string },
    MapDetailsField
  >({
    initial: () => ({ title: map.title, targetDate: map.targetDate ?? "" }),
    validate: validateMapDetails,
    onSave: (v) => onSave(v.title, v.targetDate ?? ""),
    resetOnSave: false,
  });
  const { draft, update, errors, formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <div
      role="group"
      aria-label="The map's name and date"
      className="rounded-lg border border-accent/40 bg-card p-3"
    >
      <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" error={errors.title} required>
            {(props) => (
              <Input
                {...props}
                maxLength={MAP_TITLE_MAX}
                value={draft.title}
                onChange={(e) => update({ title: e.target.value })}
              />
            )}
          </Field>
          <Field label="Due" hint="Optional." error={errors.targetDate}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={draft.targetDate}
                onChange={(e) => update({ targetDate: e.target.value })}
              />
            )}
          </Field>
        </div>
      </ItemForm>
    </div>
  );
}
