"use client";

/**
 * One method's cell in the items table, edited in place: the method's
 * result ("8.00", "Must have", "Not scored") and a button that opens the
 * method's own inputs right there (a popover anchored to the cell).
 *
 * The inputs are the method registry's (MethodInputs: Fibonacci scale
 * pickers to 20 for WSJF with "Custom" for an off-scale value the item
 * already holds, RICE's reach with its period, impact and confidence with
 * their meanings, Value/Effort's two scales). Nothing is filled in that the
 * item doesn't hold; Enter saves, Escape cancels, and focus goes back to
 * the button. A method left blank saves as Not scored ("Clear all").
 *
 * The popover is one per cell, and only the one opened renders its form,
 * so the items table's desktop rows and phone cards (both in the DOM) never
 * hold two copies of a draft.
 */

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { MethodInputs } from "@/components/prioritization/method-inputs";
import type { BacklogItem, ReachPeriod } from "@/lib/stores/workspace-types";
import { method, type MethodScore, type Values } from "@/lib/prioritization/methods";
import { cn } from "@/lib/utils";
import {
  HUB_INPUTS,
  customScores,
  heldScores,
  scoreDraft,
  validateScores,
  type HubMethodId,
} from "../hub-form";
import { itemName, methodText } from "../method-text";

/** What each editor adds under the inputs. */
const NOTE: Partial<Record<HubMethodId, string>> = {
  wsjf: "Business value is the item's one value field: Value/Effort's value too.",
  "value-effort":
    "Value is the item's one value field: WSJF's business value too. Clear all unplaces the item and keeps the value WSJF uses.",
};

export function MethodCell({
  item,
  methodId,
  result,
  period,
  onSave,
  triggerRef,
}: {
  item: BacklogItem;
  methodId: HubMethodId;
  result: MethodScore;
  /** The reach period a new RICE score starts at (the last one picked). */
  period?: ReachPeriod;
  onSave: (values: Values) => void;
  /** The edit button, for focus after "Add item". */
  triggerRef?: (el: HTMLButtonElement | null) => void;
}) {
  const m = method(methodId);
  const [open, setOpen] = useState(false);
  const text = methodText(methodId, result);
  const name = itemName(item.name);
  const unscored = result.sortKey === null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="inline-flex flex-col items-start gap-0.5">
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Edit ${m.label} for ${name} (${text})`}
            className={cn(
              "h-auto min-h-8 justify-start gap-1.5 whitespace-normal px-2 py-1 text-left",
              unscored ? "text-xs text-sub" : "font-data text-sm text-text"
            )}
          >
            <span>{text}</span>
            <Pencil className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        {result.warnings.length > 0 && (
          <span className="px-2 text-xs text-warning">{result.warnings.join(" ")}</span>
        )}
      </span>
      <PopoverContent
        align="start"
        className="w-[min(28rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]"
        aria-label={`${m.label} for ${name}`}
      >
        {open && (
          <ScoreForm
            item={item}
            methodId={methodId}
            period={period}
            onSave={(values) => {
              onSave(values);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ScoreForm({
  item,
  methodId,
  period,
  onSave,
  onCancel,
}: {
  item: BacklogItem;
  methodId: HubMethodId;
  period?: ReachPeriod;
  onSave: (values: Values) => void;
  onCancel: () => void;
}) {
  const m = method(methodId);
  const held = heldScores(methodId, item);
  const form = useItemForm<Values, Values, string>({
    initial: () => scoreDraft(methodId, item, period),
    // What the item holds may stay as it is (an off-scale value is "Custom").
    validate: (d) => validateScores(methodId, d, held),
    // The whole draft goes to the save: a blanked input is a clear.
    onSave: (_values, draft) => onSave(draft),
    resetOnSave: false,
  });
  const clearAll = () => {
    const blank: Values = {};
    for (const key of HUB_INPUTS[methodId]) if (key !== "reachPeriod") blank[key] = undefined;
    form.update(blank);
  };
  const note = NOTE[methodId];
  return (
    <ItemForm
      form={form}
      submitLabel="Save"
      onCancel={onCancel}
      footer={
        <Button type="button" variant="ghost" onClick={clearAll}>
          Clear all
        </Button>
      }
    >
      <p className="text-sm font-medium text-text">
        {m.label}: {itemName(item.name, 60)}
      </p>
      <MethodInputs
        method={m}
        draft={form.draft}
        update={form.update}
        errors={form.errors}
        custom={customScores(methodId, held)}
        only={HUB_INPUTS[methodId]}
        size="sm"
      />
      {note && <p className="text-xs text-sub">{note}</p>}
    </ItemForm>
  );
}
