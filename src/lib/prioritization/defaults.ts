/**
 * The backlog item as the method engine reads it: old "Add item" defaults
 * cleared and the legacy 1–10 value read onto the one value field.
 *
 * Before Phase 7 every backlog item was saved with mid values in every
 * method (the hub's "Add item", `createBacklogItem` and the agent's
 * add_item all filled them), so an item nobody scored still read as Must…
 * Should, WSJF 3, RICE 80 and a Fill-In. Those numbers can't be told apart
 * from a deliberate score except by their fingerprint: for each method, an
 * item whose fields ALL equal the old defaults reads as Not scored in that
 * method; one changed value keeps every value of that method.
 *
 * The rule applies only to items the new code never saved. Every write
 * through the new code (lib/prioritization/binding `applyItemPatch`) first
 * rewrites the fingerprints to unset and then stamps `updatedAt`, so a
 * deliberate "should" chosen after that is read as chosen. Nothing is
 * rewritten on load: this module is pure and idempotent, applied on read
 * by the hub, the scores, Sprint Planning and the agent actions alike.
 *
 * Known limit: a legacy item whose MoSCoW bucket really was "should" (or
 * whose four WSJF parts really were 5) reads as Not scored until it is
 * scored again; the defaults left no way to tell.
 *
 * A method row linked to such an item before Phase 7 may hold the real
 * value (old tools wrote their later edits to the row only): the methods
 * registry reads it there (methods legacyRowValues / withLegacyLinks), and
 * the item's first save through the new code writes it to the item.
 */

import type { BacklogItem } from "@/lib/stores/workspace-types";
import { fibonacciAtOrAbove } from "./methods/fibonacci";

/** The mid values every pre-Phase 7 item was created with. */
export const OLD_BACKLOG_DEFAULTS = {
  moscow: "should",
  businessValue: 5,
  timeCriticality: 5,
  riskReduction: 5,
  jobSize: 5,
  reach: 100,
  impact: 1,
  confidence: 80,
  effort: 1,
  value: 5,
  matrixEffort: 5,
} as const satisfies Partial<BacklogItem>;

export type OldDefaultField = keyof typeof OLD_BACKLOG_DEFAULTS;

/** The methods the backlog item holds inputs for. */
export type EmbeddedMethodId = "moscow" | "wsjf" | "rice" | "value-effort";

/**
 * Each embedded method's fields as the old defaults filled them. The
 * Value/Effort pair is the old matrix `value` and `matrixEffort`; clearing
 * it never touches businessValue, which is WSJF's too.
 */
export const OLD_DEFAULT_FINGERPRINTS: Readonly<
  Record<EmbeddedMethodId, readonly OldDefaultField[]>
> = {
  moscow: ["moscow"],
  wsjf: ["businessValue", "timeCriticality", "riskReduction", "jobSize"],
  rice: ["reach", "impact", "confidence", "effort"],
  "value-effort": ["value", "matrixEffort"],
};

const FINGERPRINTED = Object.keys(OLD_DEFAULT_FINGERPRINTS) as EmbeddedMethodId[];

/** True once the new code has saved the item: its values are read as they are. */
export const savedByEngine = (item: Pick<BacklogItem, "updatedAt">): boolean =>
  typeof item.updatedAt === "string" && item.updatedAt !== "";

/** The methods whose every field still holds the old default on this item. */
export function oldDefaultMethods(item: BacklogItem): EmbeddedMethodId[] {
  if (savedByEngine(item)) return [];
  return FINGERPRINTED.filter((id) =>
    OLD_DEFAULT_FINGERPRINTS[id].every((k) => item[k] === OLD_BACKLOG_DEFAULTS[k])
  );
}

/**
 * The item with each old-default fingerprint unset. The same object when
 * there is nothing to clear, so reading twice changes nothing.
 */
export function withoutOldDefaults(item: BacklogItem): BacklogItem {
  const methods = oldDefaultMethods(item);
  if (methods.length === 0) return item;
  const next: BacklogItem = { ...item };
  for (const id of methods) for (const k of OLD_DEFAULT_FINGERPRINTS[id]) delete next[k];
  return next;
}

/**
 * The one value field: `businessValue`, else the legacy 1–10 `value`
 * mapped to the Fibonacci step at or above it. `value` is never written
 * again; this is its only reader.
 */
export function itemValue(item: Pick<BacklogItem, "businessValue" | "value">): number | undefined {
  return item.businessValue ?? fibonacciAtOrAbove(item.value);
}

/**
 * The item as every method reads it: old defaults cleared, then the legacy
 * value read onto `businessValue`. Pure; the stored item is untouched.
 */
export function readBacklogItem(item: BacklogItem): BacklogItem {
  const cleared = withoutOldDefaults(item);
  const value = itemValue(cleared);
  if (value === cleared.businessValue) return cleared;
  return { ...cleared, businessValue: value };
}
