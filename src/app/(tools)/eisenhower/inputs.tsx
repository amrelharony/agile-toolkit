"use client";

import { MethodInputControl, MethodInputs } from "@/components/prioritization/method-inputs";
import type { MethodInputsSlotProps } from "@/components/prioritization/method-tool";
import { eisenhowerQuadrant } from "@/lib/prioritization/methods/eisenhower";
import { todayLocalISO } from "@/lib/utils/formatters";
import { previewText } from "./model";

/**
 * The task form's inputs (add and edit): Important? and Urgent? as Yes/No
 * choices, both unset until answered; an optional due date, which can be in
 * the past; and, once the answers say Delegate (or a name is already set),
 * who takes it from the roster. A live line under them says where the task
 * goes and why ("Urgent because it's due tomorrow, so it goes to Do.").
 */
export function EisenhowerInputs({ method, draft, update, errors, size }: MethodInputsSlotProps) {
  const today = todayLocalISO();
  const delegate = method.inputs.find((i) => i.key === "delegateTo");
  const showDelegate =
    eisenhowerQuadrant(draft, today) === "delegate" || draft.delegateTo !== undefined;
  return (
    <div className="space-y-4">
      <MethodInputs
        method={method}
        draft={draft}
        update={update}
        errors={errors}
        size={size}
        only={["important", "urgent", "dueAt"]}
        className="lg:grid-cols-3"
      />
      {showDelegate && delegate && (
        <MethodInputControl
          input={delegate}
          value={draft.delegateTo}
          error={errors.delegateTo}
          size={size}
          onChange={(v) => update({ delegateTo: v })}
        />
      )}
      <p role="status" className="text-sm text-text">
        {previewText(draft, today)}
      </p>
    </div>
  );
}
