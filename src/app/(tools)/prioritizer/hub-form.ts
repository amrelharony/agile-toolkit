/**
 * Backlog Prioritizer — the hub's two forms as pure checks.
 *
 * - "Add item": a name and an optional description, nothing else. Every
 *   method starts Not scored (no mid-range defaults, no bucket).
 * - A method's scores edited in place in the items table: the method
 *   registry's own inputs, scales and rules (lib/prioritization/methods),
 *   so the hub accepts exactly what the method's tool and the agent
 *   actions accept (WSJF's Fibonacci 1–20 with no clamp, RICE's effort of
 *   0.5 or more, Value/Effort both or neither). A method left with every
 *   input blank is valid: it saves as Not scored. The save writes the
 *   backlog item, which owns these inputs (lib/prioritization/binding), so
 *   the rows linked to it in the method tools read the change at once.
 */

import type { BacklogItem, ReachPeriod } from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { clearedKeys, ownedPatch } from "@/lib/prioritization/binding";
import { readBacklogItem } from "@/lib/prioritization/defaults";
import { method, type Values } from "@/lib/prioritization/methods";
import { defined, toNumber } from "@/lib/prioritization/methods/fields";

/* ── Add item ─────────────────────────────────────────────────────── */

/** A backlog item's name is at most this long (the store and the agent's add_item agree). */
export const NAME_MAX = 200;

export interface NewItemDraft {
  name: string;
  description: string;
}

export interface NewItemValues {
  name: string;
  description?: string;
}

export const EMPTY_NEW_ITEM: NewItemDraft = { name: "", description: "" };

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** A name is required; the description is optional. */
export function validateNewItem(d: NewItemDraft): Validation<NewItemValues, keyof NewItemDraft> {
  const name = d.name.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, errors: { name: "Enter the item's name." } };
  if (name.length > NAME_MAX) {
    return {
      ok: false,
      errors: { name: `Keep the name to ${NAME_MAX} characters (it has ${name.length}).` },
    };
  }
  const description = d.description.trim();
  return { ok: true, values: description ? { name, description } : { name } };
}

/**
 * The backlog item already holding this name (case and spacing ignored),
 * as "Add to backlog" in the method tools matches. A warning, not an
 * error: two items may share a name on purpose.
 */
export function sameNameItem(items: readonly BacklogItem[], name: string): BacklogItem | undefined {
  const key = normalize(name);
  return key ? items.find((b) => normalize(b.name ?? "") === key) : undefined;
}

/* ── Scores edited in place ───────────────────────────────────────── */

/** The methods the backlog item holds inputs for: the ones the hub edits. */
export type HubMethodId = "moscow" | "wsjf" | "rice" | "value-effort";

/**
 * The inputs the hub edits per method, by the method's input keys.
 * MoSCoW's own effort is a row-only figure for its Must budget, so it
 * stays in the MoSCoW tool.
 */
export const HUB_INPUTS: Record<HubMethodId, readonly string[]> = {
  moscow: ["bucket"],
  wsjf: ["businessValue", "timeCriticality", "rrOe", "jobSize"],
  rice: ["reach", "reachPeriod", "impact", "confidence", "effort"],
  "value-effort": ["value", "effort"],
};

/** Inputs that say how a score reads (RICE's reach period), not part of the score: set alone, the method is still blank. */
const FRAME_KEYS: ReadonlySet<string> = new Set(["reachPeriod"]);

const isBlank = (v: unknown) => v === undefined || (typeof v === "string" && v.trim() === "");

/** True when every scoring input of the method is blank: it saves as Not scored. */
export function blankScores(id: HubMethodId, draft: Values): boolean {
  return HUB_INPUTS[id].filter((k) => !FRAME_KEYS.has(k)).every((k) => isBlank(draft[k]));
}

/** The item's inputs in one method, as the engine reads them (old defaults cleared). */
export function heldScores(id: HubMethodId, item: BacklogItem): Values {
  return method(id).fromBacklog?.(item) ?? {};
}

/**
 * The editor's first draft: what the item holds, nothing filled in. A RICE
 * score the item doesn't have yet starts at the reach period last picked
 * (`period`), shown and changeable, never hidden.
 */
export function scoreDraft(id: HubMethodId, item: BacklogItem, period?: ReachPeriod): Values {
  const held = heldScores(id, item);
  const out: Values = {};
  for (const key of HUB_INPUTS[id]) if (held[key] !== undefined) out[key] = held[key];
  if (id === "rice" && period && item.reachPeriod === undefined && held.reach === undefined) {
    out.reachPeriod = period;
  }
  return out;
}

/**
 * The reach period of the RICE score saved most recently, for a new RICE
 * score to start from; undefined when no item has one.
 */
export function rememberedPeriod(items: readonly BacklogItem[]): ReachPeriod | undefined {
  let best: BacklogItem | undefined;
  for (const item of items) {
    if (!item.reachPeriod || readBacklogItem(item).reach === undefined) continue;
    if (!best || (item.updatedAt ?? "") > (best.updatedAt ?? "")) best = item;
  }
  return best?.reachPeriod;
}

/**
 * Check one method's draft. Blank everywhere: valid, saved as Not scored.
 * Otherwise the method's own rules; `keep` is what the item holds, so an
 * off-scale value it already has (a legacy WSJF 4) may stay as "Custom".
 */
export function validateScores(
  id: HubMethodId,
  draft: Values,
  keep?: Values
): Validation<Values, string> {
  const keys = HUB_INPUTS[id];
  const v: Values = {};
  for (const k of keys) v[k] = draft[k];
  if (blankScores(id, v)) return { ok: true, values: {} };
  const checked = method(id).validate(v, keep);
  if (checked.ok) return checked;
  // Only the inputs the hub shows can be in error here.
  const errors: FormErrors<string> = {};
  for (const k of keys) if (checked.errors[k]) errors[k] = checked.errors[k];
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, values: defined(v) as Values };
}

/** WSJF's parts other than the value: while any is set, WSJF still uses the value. */
const WSJF_OTHER_PARTS = ["timeCriticality", "riskReduction", "jobSize"] as const;

/**
 * The backlog fields a saved editor writes: every input it shows, a blank
 * one cleared (lib/prioritization/binding ownedPatch with the clears).
 *
 * The value is the item's one value field, WSJF's business value and the
 * Value/Effort value at once. Clearing one of those two methods whole
 * leaves the value to the other while it still uses it: clearing
 * Value/Effort unplaces the item (its effort goes) but keeps WSJF's
 * business value, and clearing WSJF keeps a value the matrix places.
 * Clearing a RICE score keeps its reach period.
 */
export function scorePatch(
  id: HubMethodId,
  values: Values,
  item: BacklogItem
): Partial<BacklogItem> {
  const keys = HUB_INPUTS[id];
  const empty = blankScores(id, values);
  const read = readBacklogItem(item);
  const full: Values = {};
  for (const k of keys) {
    if (empty && FRAME_KEYS.has(k)) continue;
    full[k] = isBlank(values[k]) ? undefined : values[k];
  }
  if (empty && id === "wsjf" && read.matrixEffort !== undefined) delete full.businessValue;
  if (empty && id === "value-effort" && WSJF_OTHER_PARTS.some((k) => read[k] !== undefined)) {
    delete full.value;
  }
  return ownedPatch(id, full, clearedKeys(full));
}

/** Off-scale values the item holds, kept on offer in the pickers as "Custom". */
export function customScores(id: HubMethodId, held: Values): Values {
  const out: Values = {};
  for (const input of method(id).inputs) {
    if (input.kind !== "scale" || !HUB_INPUTS[id].includes(input.key)) continue;
    const n = toNumber(held[input.key]);
    if (n !== undefined && !input.steps.some((s) => s.value === n)) out[input.key] = n;
  }
  return out;
}
