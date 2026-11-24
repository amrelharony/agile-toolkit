/**
 * The Impact Map page's reading of a map: its paths (goal → actor →
 * impact → deliverable, one row each, an impact with no deliverable on a
 * row of its own), where each deliverable went, the line about a linked
 * Product Goal that has closed, and the order the tree is drawn in (the
 * focus path first). The rules and edits are lib/strategy-map's.
 */

import type { ProductGoal, StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";
import { childrenOf, focusOf, nodeTitle, rootOf } from "@/lib/strategy-map/model";

export interface ImpactPath {
  key: string;
  goal: StrategyMapNode;
  actor?: StrategyMapNode;
  impact?: StrategyMapNode;
  deliverable?: StrategyMapNode;
  /** On the focus impact's path. */
  focus: boolean;
}

/** Every path from the goal down, the focus impact's first, in the map's order otherwise. */
export function impactPaths(map: StrategyMap): ImpactPath[] {
  const goal = rootOf(map);
  if (!goal) return [];
  const focus = focusOf(map);
  const rows: ImpactPath[] = [];
  const actors = childrenOf(map, goal.id);
  if (actors.length === 0) rows.push({ key: goal.id, goal, focus: false });
  for (const actor of actors) {
    const impacts = childrenOf(map, actor.id);
    if (impacts.length === 0) rows.push({ key: actor.id, goal, actor, focus: false });
    for (const impact of impacts) {
      const onFocus = impact.id === focus?.id;
      const deliverables = childrenOf(map, impact.id);
      if (deliverables.length === 0)
        rows.push({ key: impact.id, goal, actor, impact, focus: onFocus });
      for (const deliverable of deliverables) {
        rows.push({ key: deliverable.id, goal, actor, impact, deliverable, focus: onFocus });
      }
    }
  }
  return [...rows.filter((r) => r.focus), ...rows.filter((r) => !r.focus)];
}

/** The tree's drawing order: the actor holding the focus impact first, and that impact first under it. */
export function focusFirst(map: StrategyMap): (list: StrategyMapNode[]) => StrategyMapNode[] {
  const focus = focusOf(map);
  if (!focus) return (list) => list;
  const onPath = new Set([focus.id, focus.parentId ?? ""]);
  return (list) => [
    ...list.filter((n) => onPath.has(n.id)),
    ...list.filter((n) => !onPath.has(n.id)),
  ];
}

/** The child line under a linked Product Goal that is no longer active; null while it is. */
export function goalClosedLine(goal: ProductGoal): string | null {
  if (goal.status === "achieved") return "This Product Goal was achieved.";
  if (goal.status === "abandoned") return "This Product Goal was dropped.";
  return null;
}

/** A path as one line: "Busy parents → Skip a week → Pause instead of cancel". */
export function pathLine(map: StrategyMap, p: ImpactPath): string {
  return [p.actor, p.impact, p.deliverable]
    .filter((n): n is StrategyMapNode => Boolean(n))
    .map((n) => nodeTitle(n, map.format))
    .join(" → ");
}
