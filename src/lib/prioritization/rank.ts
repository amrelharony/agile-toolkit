/**
 * Ranking: one method's order, the consensus across methods, and the
 * backlog's decided order. Pure and server-safe.
 *
 * - `rankByMethod`: the items a method has scored, in its order. Tied items
 *   share the average of their places (two tied for 2nd are both 2.5), and
 *   each gets a normalised rank from 1 (top) to 0 (bottom). A method with
 *   fewer than 2 scored items ranks nothing.
 * - `bordaConsensus`: each item's mean normalised rank over the methods
 *   that scored it (a Borda count), with how many did (coverage) and how
 *   far they disagree (spread). Unscored items follow, in stored order.
 * - `decidedOrder` / `ranksFromOrder`: BacklogItem.rank, set only by the
 *   Prioritizer's Decide order: 1-based, unique among ranked items; an item
 *   without one is "Not ordered yet" and follows, in stored order.
 * - `rankMethodRows`: a method tool's rows, scored (read through to their
 *   items), in the method's order with a dense rank, unscored last.
 */

import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { linkedItem } from "./binding";
import {
  HUB_METHOD_IDS,
  compareResults,
  evaluateItemIn,
  method,
  readThrough,
  type EvalContext,
  type MethodId,
  type MethodScore,
  type Values,
} from "./methods";

export interface MethodRanking {
  method: MethodId;
  /** Items the method scored. */
  n: number;
  /** 1-based place; tied items share the average of their places. */
  position: ReadonlyMap<string, number>;
  /** (n − place) ÷ (n − 1): 1 for the top, 0 for the bottom. */
  normalized: ReadonlyMap<string, number>;
}

/**
 * Tied-average places for results already in order: entries that compare
 * equal share the mean of the places they span.
 */
function tiedPositions<T>(ordered: readonly T[], equal: (a: T, b: T) => boolean): number[] {
  const out: number[] = new Array(ordered.length);
  let i = 0;
  while (i < ordered.length) {
    let j = i;
    while (j + 1 < ordered.length && equal(ordered[i], ordered[j + 1])) j++;
    const avg = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k++) out[k] = avg;
    i = j + 1;
  }
  return out;
}

/** The items a method scored, in its order; null when fewer than 2 are scored. */
export function rankByMethod(
  items: readonly BacklogItem[],
  rows: readonly PrioritizationItem[],
  id: MethodId,
  ctx?: EvalContext
): MethodRanking | null {
  const m = method(id);
  const scored = items
    .map((item) => ({ id: item.id, result: evaluateItemIn(item, rows, id, ctx) }))
    .filter((e) => e.result.sortKey !== null);
  if (scored.length < 2) return null;
  // Array.prototype.sort is stable: ties keep the stored order.
  scored.sort((a, b) => compareResults(m, a.result, b.result));
  const places = tiedPositions(scored, (a, b) => compareResults(m, a.result, b.result) === 0);
  const n = scored.length;
  const position = new Map<string, number>();
  const normalized = new Map<string, number>();
  scored.forEach((e, i) => {
    position.set(e.id, places[i]);
    normalized.set(e.id, (n - places[i]) / (n - 1));
  });
  return { method: id, n, position, normalized };
}

/** Which methods a consensus can use: each with 2 or more scored items. */
export function consensusMethods(
  items: readonly BacklogItem[],
  rows: readonly PrioritizationItem[],
  ids: readonly MethodId[] = HUB_METHOD_IDS,
  ctx?: EvalContext
): { used: MethodRanking[]; skipped: { method: MethodId; n: number }[] } {
  const used: MethodRanking[] = [];
  const skipped: { method: MethodId; n: number }[] = [];
  for (const id of ids) {
    const ranking = rankByMethod(items, rows, id, ctx);
    if (ranking) used.push(ranking);
    else {
      const n = items.filter((i) => evaluateItemIn(i, rows, id, ctx).sortKey !== null).length;
      skipped.push({ method: id, n });
    }
  }
  return { used, skipped };
}

/**
 * Above this spread (an item's best normalised place minus its worst, 0–1)
 * the methods disagree on the item: the Prioritizer's Decide order and
 * verdict, and tool.prioritizer.decide_order's `disagree`, read this one.
 */
export const DISAGREE_SPREAD = 0.5;

export interface ConsensusRow {
  itemId: string;
  /** Mean normalised rank over the methods that scored it, 0–1 (1 = top); null when none did. */
  borda: number | null;
  /** How many of the methods scored it. */
  coverage: number;
  /** Highest minus lowest normalised rank (0–1); null below 2 methods. */
  spread: number | null;
  /** Its place in each method that scored it (tied places averaged). */
  perMethod: Partial<Record<MethodId, number>>;
}

/**
 * The Borda consensus over `ids` (default: every hub method with 2 or more
 * scored items). Ordered by consensus, then coverage, then the current
 * decided rank, then name, then id, so the order never depends on how the
 * list happened to be stored; items no method scored follow in stored order.
 */
export function bordaConsensus(
  items: readonly BacklogItem[],
  rows: readonly PrioritizationItem[],
  ids?: readonly MethodId[],
  ctx?: EvalContext
): ConsensusRow[] {
  const rankings = ids
    ? ids
        .map((id) => rankByMethod(items, rows, id, ctx))
        .filter((r): r is MethodRanking => r !== null)
    : consensusMethods(items, rows, HUB_METHOD_IDS, ctx).used;
  const rowsOut: (ConsensusRow & { index: number; item: BacklogItem })[] = items.map(
    (item, index) => {
      const norms: number[] = [];
      const perMethod: Partial<Record<MethodId, number>> = {};
      for (const r of rankings) {
        const norm = r.normalized.get(item.id);
        if (norm === undefined) continue;
        norms.push(norm);
        perMethod[r.method] = r.position.get(item.id);
      }
      const coverage = norms.length;
      return {
        itemId: item.id,
        borda: coverage > 0 ? norms.reduce((s, x) => s + x, 0) / coverage : null,
        coverage,
        spread: coverage >= 2 ? Math.max(...norms) - Math.min(...norms) : null,
        perMethod,
        index,
        item,
      };
    }
  );
  const rankOf = (b: BacklogItem) =>
    typeof b.rank === "number" && Number.isFinite(b.rank) ? b.rank : Infinity;
  const scored = rowsOut
    .filter((r) => r.borda !== null)
    .sort(
      (a, b) =>
        (b.borda as number) - (a.borda as number) ||
        b.coverage - a.coverage ||
        rankOf(a.item) - rankOf(b.item) ||
        (a.item.name ?? "").localeCompare(b.item.name ?? "") ||
        (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)
    );
  const unscored = rowsOut.filter((r) => r.borda === null);
  return [...scored, ...unscored].map(({ itemId, borda, coverage, spread, perMethod }) => ({
    itemId,
    borda,
    coverage,
    spread,
    perMethod,
  }));
}

const hasRank = (r: unknown): r is number => typeof r === "number" && Number.isFinite(r) && r > 0;

/** The decided order: ranked items by rank, then the unranked in stored order. */
export function decidedOrder<T extends Pick<BacklogItem, "id" | "rank">>(items: readonly T[]): T[] {
  const indexed = items.map((item, index) => ({ item, index }));
  const ranked = indexed
    .filter((e) => hasRank(e.item.rank))
    .sort((a, b) => (a.item.rank as number) - (b.item.rank as number) || a.index - b.index);
  const unranked = indexed.filter((e) => !hasRank(e.item.rank));
  return [...ranked, ...unranked].map((e) => e.item);
}

/** Ranks 1..N for an order of ids (a repeated id keeps its first place). */
export function ranksFromOrder(ids: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of ids) if (!out.has(id)) out.set(id, out.size + 1);
  return out;
}

export interface RankedRow {
  row: PrioritizationItem;
  /** The inputs the row scores from (read through to its item). */
  values: Values;
  result: MethodScore;
  /** Dense rank among scored rows (ties share it); null when not scored. */
  rank: number | null;
  /** Read through to a backlog item that still exists. */
  live: boolean;
}

/**
 * A method's rows, scored and ordered: scored rows in the method's order
 * with a dense rank (ties share it), then the unscored ones in stored order.
 */
export function rankMethodRows(
  id: MethodId,
  rows: readonly PrioritizationItem[],
  items: readonly BacklogItem[] = [],
  ctx?: EvalContext
): RankedRow[] {
  const m = method(id);
  const scoredRows = rows
    .filter((r) => r.framework === id)
    .map((row) => {
      const item = m.embedded ? linkedItem(row, items) : undefined;
      const values = m.read(readThrough(row, item));
      return {
        row,
        values,
        result: m.evaluate(values, ctx),
        rank: null as number | null,
        live: !!item,
      };
    });
  scoredRows.sort((a, b) => compareResults(m, a.result, b.result));
  let rank = 0;
  let prev: MethodScore | null = null;
  for (const r of scoredRows) {
    if (r.result.sortKey === null) break;
    if (prev === null || compareResults(m, prev, r.result) !== 0) rank += 1;
    r.rank = rank;
    prev = r.result;
  }
  return scoredRows;
}
