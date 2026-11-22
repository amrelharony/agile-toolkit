/**
 * The path from a strategy map's root to one of its nodes: what the Impact
 * Map and Strategy Tree show as "why", and what the Epic Roadmap reads for
 * an epic sent from a map (its "Why:" line). Pure, types only. Frozen after
 * the base: the strategy-map model re-exports it, and nothing redefines it.
 */

import type { HandoffRef, StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";

/** The tools whose sent items point back into a strategy map. */
const STRATEGY_MAP_TOOLS: readonly string[] = ["impact-map", "strategy-tree"];

/**
 * Root → … → `node`, following `parentId`. It stops early, at the furthest
 * ancestor it can reach, on a parent that isn't on the map or one it has
 * already passed (a loop), so it always ends at `node`.
 */
export function pathOf(map: StrategyMap, node: StrategyMapNode): StrategyMapNode[] {
  const byId = new Map(map.nodes.map((n) => [n.id, n] as const));
  const path = [node];
  const seen = new Set([node.id]);
  let current = node;
  while (current.parentId !== null) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    path.push(parent);
    seen.add(parent.id);
    current = parent;
  }
  return path.reverse();
}

/**
 * The map an item came from and the path to its node, for a `sourceRef`
 * from Impact Map or Strategy Tree: the map whose id is `ref.doc`, and the
 * path to the node `ref.id`. Null for any other tool, a ref with no `doc`,
 * or a map or node that is gone.
 */
export function sourcePath(
  maps: readonly StrategyMap[],
  ref: HandoffRef | undefined
): { map: StrategyMap; path: StrategyMapNode[] } | null {
  if (!ref || !STRATEGY_MAP_TOOLS.includes(ref.tool) || !ref.doc) return null;
  const map = maps.find((m) => m.id === ref.doc);
  const node = map?.nodes.find((n) => n.id === ref.id);
  if (!map || !node) return null;
  return { map, path: pathOf(map, node) };
}
