/**
 * Backlog Prioritizer — the one-sentence verdicts: how much of the backlog
 * is ordered and whether the methods agree (the hub and Decide order), and
 * what the methods put first (All methods).
 *
 * Every place and consensus comes from lib/prioritization/rank, the code
 * tool.prioritizer.decide_order runs, so the sentence and the agent read
 * the same disagreement on the same data.
 */

import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import {
  bordaConsensus,
  consensusMethods,
  type ConsensusRow,
  type MethodRanking,
} from "@/lib/prioritization/rank";
import { evaluateItemIn, method, type MethodId } from "@/lib/prioritization/methods";
import { HUB_METHODS, countText, itemName, listText } from "./method-text";
import { placeWord, rankOf } from "./order";

/**
 * Above this spread (an item's best normalised place minus its worst, 0–1)
 * the methods disagree on the item. tool.prioritizer.decide_order flags the
 * same items (`disagree`).
 */
export const DISAGREE_SPREAD = 0.5;

export interface OrderAnalysis {
  /** The methods the consensus uses: each with 2 or more items scored (and picked). */
  used: MethodRanking[];
  /** Methods left out for having fewer than 2 items scored, with how many they have. */
  skipped: { method: MethodId; n: number }[];
  /** Every item: the consensus order, then the items no used method scored. */
  consensus: ConsensusRow[];
  /** Items the used methods disagree on (spread over DISAGREE_SPREAD), most first. */
  disagree: ConsensusRow[];
  /** Ids of the items no used method scored. */
  unscored: string[];
  /** Items with a saved rank. */
  ordered: number;
  total: number;
}

/**
 * What the methods say about the backlog's order. `pick` limits the
 * consensus to those methods (the Decide order chips); by default it uses
 * every hub method with 2 or more items scored.
 */
export function analyseOrder(
  items: readonly BacklogItem[],
  rows: readonly PrioritizationItem[],
  pick?: readonly MethodId[]
): OrderAnalysis {
  const { used: available, skipped } = consensusMethods(items, rows, HUB_METHODS);
  const used = pick ? available.filter((r) => pick.includes(r.method)) : available;
  const consensus = bordaConsensus(
    items,
    rows,
    used.map((r) => r.method)
  );
  const disagree = consensus
    .map((row, index) => ({ row, index }))
    .filter((e) => e.row.spread !== null && e.row.spread > DISAGREE_SPREAD)
    .sort((a, b) => (b.row.spread as number) - (a.row.spread as number) || a.index - b.index)
    .map((e) => e.row);
  return {
    used,
    skipped,
    consensus,
    disagree,
    unscored: consensus.filter((c) => c.borda === null).map((c) => c.itemId),
    ordered: items.filter((i) => rankOf(i) !== undefined).length,
    total: items.length,
  };
}

/** The methods that put an item highest and lowest, with its place in each. */
function extremes(used: readonly MethodRanking[], id: string) {
  let hi: MethodRanking | undefined;
  let lo: MethodRanking | undefined;
  for (const r of used) {
    const n = r.normalized.get(id);
    if (n === undefined) continue;
    if (!hi || n > (hi.normalized.get(id) as number)) hi = r;
    if (!lo || n < (lo.normalized.get(id) as number)) lo = r;
  }
  return hi && lo ? { hi, lo } : null;
}

/** How much of the backlog is ordered, as the verdict's first half. */
function orderedText(ordered: number, total: number): string {
  if (total === 1) return ordered === 1 ? "The item is ordered" : "The item isn't ordered yet";
  if (ordered === 0) return `None of the ${total} items is ordered yet`;
  if (ordered === total) return `All ${total} items are ordered`;
  return `${ordered} of ${total} items are ordered`;
}

/**
 * One sentence: how many items are ordered and whether the methods agree,
 * naming the item they split on most ("1st in WSJF, 6th in RICE").
 */
export function orderVerdict(a: OrderAnalysis, nameOf: (id: string) => string): string {
  if (a.total === 0) return "Nothing to order yet: add an item to the backlog first.";
  const done = orderedText(a.ordered, a.total);
  if (a.used.length === 0) {
    return `${done}; score 2 or more items in one method to see what the methods say.`;
  }
  const labels = a.used.map((r) => method(r.method).label);
  if (a.used.length === 1) {
    return `${done}; only ${labels[0]} has 2 or more items scored, so the consensus is its order.`;
  }
  if (a.disagree.length === 0) return `${done}; ${listText(labels)} broadly agree.`;
  const top = a.disagree[0];
  const ends = extremes(a.used, top.itemId);
  const where = ends
    ? ` (${placeWord(ends.hi, top.itemId)} in ${method(ends.hi.method).label}, ${placeWord(ends.lo, top.itemId)} in ${method(ends.lo.method).label})`
    : "";
  const n = a.disagree.length;
  const on = n === 1 ? "" : `${countText(n, "item")}, most on `;
  return `${done}; the methods disagree on ${on}“${nameOf(top.itemId)}”${where}.`;
}

/**
 * One sentence over All methods: the item the methods put first (when two
 * or more agree on it) or that they each pick a different one, and how
 * many items no method has scored.
 */
export function methodsVerdict(
  items: readonly BacklogItem[],
  rows: readonly PrioritizationItem[]
): string {
  if (items.length === 0) return "Add backlog items to compare the methods.";
  const name = (id: string) => itemName(items.find((i) => i.id === id)?.name);
  const unscored = items.filter((i) =>
    HUB_METHODS.every((id) => evaluateItemIn(i, rows, id).sortKey === null)
  ).length;
  const tail =
    unscored === 0
      ? ""
      : `; ${countText(unscored, "item")} ${unscored === 1 ? "isn't" : "aren't"} scored in any method yet`;
  const { used } = consensusMethods(items, rows, HUB_METHODS);
  if (used.length === 0) {
    return `No method has 2 or more items scored yet${tail}.`;
  }
  // Each method's single top item (a method tied at the top names none).
  const tops = new Map<string, string[]>();
  for (const r of used) {
    const first = Array.from(r.position.entries()).filter(([, p]) => p === 1);
    if (first.length !== 1) continue;
    const id = first[0][0];
    tops.set(id, [...(tops.get(id) ?? []), method(r.method).label]);
  }
  const best = Array.from(tops.entries()).sort((a, b) => b[1].length - a[1].length)[0];
  if (used.length === 1) {
    const lead = best ? `, with “${name(best[0])}” first` : ", with a tie at the top";
    return `Only ${method(used[0].method).label} ranks 2 or more items so far${lead}${tail}.`;
  }
  if (best && best[1].length >= 2) {
    return `“${name(best[0])}” comes first in ${listText(best[1])}${tail}.`;
  }
  if (tops.size === 0) return `Every method has a tie at the top${tail}.`;
  const each = Array.from(tops.entries()).map(([id, labels]) => `“${name(id)}” in ${labels[0]}`);
  return `The methods put different items first: ${listText(each)}${tail}.`;
}
