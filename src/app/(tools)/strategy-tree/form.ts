/**
 * The Strategy Tree's new-tree check: a shape and its root's text, within
 * the cap. Nothing is saved blank.
 */

import type { FormErrors, Validation } from "@/lib/utils/form";
import { isTreeFormat, levelOf, type TreeFormat } from "@/lib/strategy-map/formats";
import { NODE_TEXT_MAX } from "@/lib/strategy-map/model";

export interface NewTreeDraft {
  format: TreeFormat | "";
  root: string;
}

export type NewTreeField = keyof NewTreeDraft;

export interface NewTreeValues {
  format: TreeFormat;
  root: string;
}

export const emptyNewTree = (): NewTreeDraft => ({ format: "", root: "" });

export function validateNewTree(d: NewTreeDraft): Validation<NewTreeValues, NewTreeField> {
  const errors: FormErrors<NewTreeField> = {};
  const root = d.root.replace(/\s+/g, " ").trim();
  if (!isTreeFormat(d.format)) errors.format = "Pick a shape for the tree.";
  if (!root) {
    errors.root = isTreeFormat(d.format)
      ? `Say the ${levelOf(d.format, 0).label.toLowerCase()}.`
      : "Say what the tree starts from.";
  } else if (root.length > NODE_TEXT_MAX) {
    errors.root = `Keep it to ${NODE_TEXT_MAX} characters or fewer.`;
  }
  if (Object.keys(errors).length > 0 || !isTreeFormat(d.format)) return { ok: false, errors };
  return { ok: true, values: { format: d.format, root } };
}
