"use client";

import { createContext, useContext } from "react";
import { MethodInputs } from "@/components/prioritization/method-inputs";
import {
  MethodRowEditor,
  validateMethodDraft,
  type MethodDraft,
  type MethodInputsSlotProps,
  type MethodToolConfig,
  type MethodValidateContext,
} from "@/components/prioritization/method-tool";
import { VALUE_EFFORT } from "@/lib/prioritization/methods";
import { toNumber } from "@/lib/prioritization/methods/fields";
import type { RankedRow } from "@/lib/prioritization/rank";
import type { Validation } from "@/lib/utils/form";
import { VE_CONFIG } from "./config";
import { placeOf, trayNote } from "./model";

/** The backlog item the row being edited reads through to, and what it shows now. */
interface Linked {
  name: string;
  at: { value: number | null; effort: number | null };
}

const LinkedItem = createContext<Linked | null>(null);

const blank = (v: unknown) => v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * The editor's inputs: the method's value and effort pickers, and, for a
 * row linked to a backlog item whose draft blanks both, what saving does to
 * the item, said before Save (trayNote: its effort is cleared there, its
 * value stays). A polite live region, so the note is heard as it appears.
 */
function VeEditorInputs(props: MethodInputsSlotProps) {
  const linked = useContext(LinkedItem);
  const toTray = linked !== null && blank(props.draft.value) && blank(props.draft.effort);
  return (
    <>
      <MethodInputs {...props} className="xl:grid-cols-2" />
      <p role="status" className={toTray ? "text-xs text-warning" : "sr-only"}>
        {toTray && linked ? trayNote(linked.name, linked.at) : ""}
      </p>
    </>
  );
}

/**
 * The editor's check: the method's (validateMethodDraft), except for a row
 * that waits in the tray holding a value but no effort (a linked item's
 * value, WSJF's business value too, kept when it was un-placed or
 * imported). That value left as it is may stay without an effort, so the
 * row can be renamed or its note edited. A new value still needs an
 * effort, and a placed row that loses only its effort is still told to
 * clear both (and then sees the tray note).
 */
function checkEdit(
  d: MethodDraft,
  { editing, keep }: MethodValidateContext
): Validation<MethodDraft, string> {
  const held = editing ? placeOf(editing) : null;
  if (
    held &&
    held.value !== null &&
    held.effort === null &&
    blank(d.effort) &&
    toNumber(d.value) === held.value
  ) {
    const checked = validateMethodDraft(VALUE_EFFORT, { ...d, value: undefined }, true, keep);
    return checked.ok ? { ok: true, values: { ...checked.values, value: held.value } } : checked;
  }
  return validateMethodDraft(VALUE_EFFORT, d, true, keep);
}

const EDITOR_CONFIG: MethodToolConfig = {
  ...VE_CONFIG,
  Inputs: VeEditorInputs,
  validate: checkEdit,
};

/**
 * Edit a row in place (the method shell's editor: Enter saves, Escape
 * cancels), with the tray note above for a row linked to `itemName`.
 */
export function VeRowEditor({
  ranked,
  itemName,
  onSave,
  onCancel,
}: {
  ranked: RankedRow;
  /** The linked backlog item's name; undefined for a row that owns its values. */
  itemName?: string;
  onSave: (draft: MethodDraft) => void;
  onCancel: () => void;
}) {
  const linked = itemName !== undefined ? { name: itemName, at: placeOf(ranked) } : null;
  return (
    <LinkedItem.Provider value={linked}>
      <MethodRowEditor config={EDITOR_CONFIG} ranked={ranked} onSave={onSave} onCancel={onCancel} />
    </LinkedItem.Provider>
  );
}
