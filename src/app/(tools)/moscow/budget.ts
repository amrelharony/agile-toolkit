import type { BacklogItem } from "@/lib/stores/workspace-types";
import { linkedItem } from "@/lib/prioritization/binding";
import { readThrough } from "@/lib/prioritization/methods";
import { toChoice } from "@/lib/prioritization/methods/fields";
import {
  MOSCOW_BUCKETS,
  moscowEffort,
  mustBudget,
  type MoscowBucket,
  type MoscowBudget,
} from "@/lib/prioritization/methods/moscow";
import type { RankedRow } from "@/lib/prioritization/rank";

/** A row's bucket as the registry read it (null: not sorted yet). */
export const bucketOf = (r: RankedRow): MoscowBucket | null =>
  toChoice(MOSCOW_BUCKETS, r.result.bucket) ?? null;

/** Where a row's effort comes from, for the row and the budget's note. */
export type EffortSource = "backlog" | "row" | null;

/**
 * A row's effort for the Must budget and where it came from: a linked
 * item's WSJF job size, else the row's own effort (the registry's
 * moscowEffort, what tool.moscow.list_items counts too).
 */
export function effortOf(
  r: RankedRow,
  items: readonly BacklogItem[]
): { effort: number | null; source: EffortSource } {
  const item = linkedItem(r.row, items);
  const effort = moscowEffort(readThrough(r.row, item), item);
  if (effort === null) return { effort, source: null };
  const fromItem = item ? moscowEffort(undefined, item) : null;
  return { effort, source: fromItem !== null ? "backlog" : "row" };
}

/** An effort the budget counts (mustBudget's rule: a finite number, 0 or more). */
const isSized = (effort: number | null): effort is number =>
  effort !== null && Number.isFinite(effort) && effort >= 0;

/** The Must budget as the page reads it: the registry's, plus the Musts it couldn't count. */
export interface MoscowPageBudget extends MoscowBudget {
  /**
   * Musts with no effort. The share leaves them out, so while any is
   * unsized it can only rise: the page never calls it inside the limit.
   */
  unsizedMusts: number;
}

/**
 * The Must budget over the tool's rows, by the registry's mustBudget (Won't
 * left out of the plan, a share only from three sized items): the same
 * entries tool.moscow.list_items builds, so the page and the agent agree.
 */
export function budgetOf(
  rows: readonly RankedRow[],
  items: readonly BacklogItem[]
): MoscowPageBudget {
  const entries = rows.map((r) => ({ bucket: bucketOf(r), effort: effortOf(r, items).effort }));
  return {
    ...mustBudget(entries),
    unsizedMusts: entries.filter((e) => e.bucket === "must" && !isSized(e.effort)).length,
  };
}

/**
 * The planned rows (Must, Should, Could) the budget can't count yet, in
 * list order, each with whether it's on the backlog: a linked item gets
 * its job size in the Backlog Prioritizer, any other row an effort here.
 */
export function unsizedPlanned(
  rows: readonly RankedRow[],
  items: readonly BacklogItem[]
): { ranked: RankedRow; linked: boolean }[] {
  return rows
    .filter((r) => {
      const bucket = bucketOf(r);
      return bucket !== null && bucket !== "wont" && !isSized(effortOf(r, items).effort);
    })
    .map((r) => ({ ranked: r, linked: linkedItem(r.row, items) !== undefined }));
}
