/**
 * Backlog Prioritizer — WSJF + RICE score helpers. Pure, NaN-guarded against
 * legacy persisted rows missing newer fields.
 */

import type { BacklogItem } from "./types";

export function wsjfScore(item: BacklogItem): number {
  const cod = item.businessValue + item.timeCriticality + item.riskReduction;
  return parseFloat((cod / Math.max(1, item.jobSize)).toFixed(2));
}

export function riceScore(item: BacklogItem): number {
  // Guard against legacy persisted rows missing `effort`. `Math.max(0.1,
  // undefined)` is NaN, which propagates to a "NaN" score in the table —
  // not a crash, but visually broken in a way users can't recover from
  // without manual edits.
  const reach = Number.isFinite(item.reach) ? item.reach : 0;
  const impact = Number.isFinite(item.impact) ? item.impact : 0;
  const confidence = Number.isFinite(item.confidence) ? item.confidence : 0;
  const effort = Number.isFinite(item.effort) ? item.effort : 1;
  return parseFloat(((reach * impact * (confidence / 100)) / Math.max(0.1, effort)).toFixed(1));
}
