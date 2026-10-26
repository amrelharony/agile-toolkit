/**
 * Backlog Prioritizer — the decided order, as pure helpers for the Decide
 * order step and the MoSCoW tab.
 *
 * BacklogItem.rank (1-based, unique among ranked items) is set only by a
 * decided order: the hub's "Save order", a reorder in the MoSCoW tab (among
 * a bucket's items already ordered), or the agent's
 * tool.prioritizer.set_order, all through `ranksFromOrder`. An
 * item without one is "Not ordered yet" and follows the ranked ones in
 * stored order (`decidedOrder`), which is the order Sprint Planning
 * imports in. The per-method places and the consensus come from
 * lib/prioritization/rank, the code tool.prioritizer.decide_order runs.
 */

import type { BacklogItem } from "@/lib/stores/workspace-types";
import { decidedOrder, type ConsensusRow, type MethodRanking } from "@/lib/prioritization/rank";

/** An item's saved rank, or undefined while it is "Not ordered yet". */
export function rankOf(item: Pick<BacklogItem, "rank">): number | undefined {
  const r = item.rank;
  return typeof r === "number" && Number.isFinite(r) && r > 0 ? r : undefined;
}

/** The saved order: the ids of the ranked items, rank 1 first. */
export function savedOrder(items: readonly BacklogItem[]): string[] {
  return decidedOrder(items)
    .filter((i) => rankOf(i) !== undefined)
    .map((i) => i.id);
}

/** True when two orders list the same ids in the same order. */
export const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * `ids` with `id` moved to index `to` (clamped to the list). The same array
 * when it doesn't move or isn't in the list, so a no-op writes nothing.
 */
export function moveTo(ids: readonly string[], id: string, to: number): readonly string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const at = Math.max(0, Math.min(ids.length - 1, Math.round(to)));
  if (at === from) return ids;
  const next = ids.filter((x) => x !== id);
  next.splice(at, 0, id);
  return next;
}

/**
 * A reorder inside one group (a MoSCoW bucket) as the whole backlog's order
 * to save. Only the group's ordered items take part: they swap among the
 * places they hold in the saved order, so nothing in another bucket moves
 * and nothing is ordered that the team never placed. (Ordering a bucket's
 * unordered items by the move would put them at the top of an otherwise
 * unordered backlog, ahead of every unordered Must: their places come from
 * Decide order.) `next` is the group's ordered items in their new order; a
 * list that isn't exactly those (stale, or naming an item that isn't
 * ordered) changes nothing.
 */
export function groupReorder(items: readonly BacklogItem[], next: readonly string[]): string[] {
  const saved = savedOrder(items);
  const members = new Set(next);
  const slots: number[] = [];
  saved.forEach((id, i) => {
    if (members.has(id)) slots.push(i);
  });
  if (slots.length !== next.length || members.size !== next.length) return saved;
  const out = [...saved];
  slots.forEach((slot, i) => {
    out[slot] = next[i];
  });
  return out;
}

/* ── Places ───────────────────────────────────────────────────────── */

const tieCache = new WeakMap<MethodRanking, Map<number, number>>();

/** How many items share each place in a method's ranking. */
function tiesOf(ranking: MethodRanking): Map<number, number> {
  let ties = tieCache.get(ranking);
  if (!ties) {
    ties = new Map();
    for (const p of Array.from(ranking.position.values())) ties.set(p, (ties.get(p) ?? 0) + 1);
    tieCache.set(ranking, ties);
  }
  return ties;
}

/**
 * An item's place in a method as the span it shares: rankByMethod gives
 * tied items the average of their places (two tied for 2nd are both 2.5),
 * which reads as "tied 2–3". Null when the method didn't score the item.
 */
export function placeSpan(
  ranking: MethodRanking | undefined,
  id: string
): { place: number; from: number; to: number; tied: boolean } | null {
  const p = ranking?.position.get(id);
  if (!ranking || p === undefined) return null;
  const k = tiesOf(ranking).get(p) ?? 1;
  const half = (k - 1) / 2;
  return { place: p, from: p - half, to: p + half, tied: k > 1 };
}

/** "3", "tied 2–3", or null when the method didn't score the item. */
export function placeText(ranking: MethodRanking | undefined, id: string): string | null {
  const s = placeSpan(ranking, id);
  if (!s) return null;
  return s.tied ? `tied ${s.from}–${s.to}` : String(s.place);
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const r100 = n % 100;
  if (r100 >= 11 && r100 <= 13) return `${n}th`;
  const r10 = n % 10;
  return `${n}${r10 === 1 ? "st" : r10 === 2 ? "nd" : r10 === 3 ? "rd" : "th"}`;
}

/** "1st", "joint 2nd" (a tie), or null when the method didn't score the item. */
export function placeWord(ranking: MethodRanking | undefined, id: string): string | null {
  const s = placeSpan(ranking, id);
  if (!s) return null;
  return s.tied ? `joint ${ordinal(s.from)}` : ordinal(s.place);
}

export interface ConsensusPlace {
  row: ConsensusRow;
  /** 1-based place in the consensus; items with the same consensus and coverage share it. Null: no method scored it. */
  place: number | null;
  /** Shares its place with another item. */
  tied: boolean;
}

/**
 * The consensus rows with their places. bordaConsensus breaks ties for a
 * stable list (coverage, then the saved rank, then the name), but two items
 * with the same consensus and coverage are still a tie, and say so.
 */
export function consensusPlaces(rows: readonly ConsensusRow[]): ConsensusPlace[] {
  const out: ConsensusPlace[] = rows.map((row) => ({ row, place: null, tied: false }));
  let prev: ConsensusPlace | null = null;
  out.forEach((p, i) => {
    if (p.row.borda === null) return;
    if (prev && prev.row.borda === p.row.borda && prev.row.coverage === p.row.coverage) {
      p.place = prev.place;
      p.tied = true;
      prev.tied = true;
    } else {
      p.place = i + 1;
    }
    prev = p;
  });
  return out;
}

/**
 * A consensus as 0–100 with one decimal place (100 = top in every method
 * that scored it): the number tool.prioritizer.list_state and decide_order
 * report, so the screen and the agent say 62.5 for the same item.
 */
export const consensusScore = (borda: number | null): number | null =>
  borda === null ? null : Math.round(borda * 1000) / 10;

/** "Moved “X” to 3 of 12." (`where`: " in Must have"). */
export function movedText(name: string, position: number, of: number, where = ""): string {
  return `Moved “${name}” to ${position} of ${of}${where}.`;
}
