"use client";

/**
 * A strategy map drawn as nested lists, root first: each part's card, and
 * under it a list named "Under <part>" holding its children. Indents stop
 * after three levels so a phone keeps its width (the Opportunity Tree does
 * the same). `order` lets a page draw some children first (Impact Map's
 * focus path).
 */

import type { ReactNode } from "react";
import type { StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";
import { drawTree } from "@/lib/trees/parent-tree";
import { nodeTitle } from "@/lib/strategy-map/model";
import { cn } from "@/lib/utils";

/** Levels that indent; deeper ones line up under their parent. */
const INDENT_LEVELS = 3;
/** A map is four levels deep: anything deeper is a hand-edited chain the page doesn't draw. */
const MAX_DEPTH = 4;

export function LevelTree({
  map,
  label,
  renderNode,
  order,
}: {
  map: StrategyMap;
  /** The outer list's name: "Impact map", "Strategy tree". */
  label: string;
  renderNode: (node: StrategyMapNode) => ReactNode;
  order?: (children: StrategyMapNode[]) => StrategyMapNode[];
}) {
  const drawn = drawTree(map.nodes);
  const seen = new Set<string>();
  const sorted = (list: StrategyMapNode[]) => (order ? order(list) : list);
  const draw = (node: StrategyMapNode, depth: number): ReactNode => {
    if (depth >= MAX_DEPTH || seen.has(node.id)) return null;
    seen.add(node.id);
    const children = sorted(drawn.childrenOf(node.id));
    return (
      <li key={node.id} className="min-w-0 space-y-2">
        {renderNode(node)}
        {children.length > 0 && (
          <ul
            className={cn(
              "space-y-2 border-l border-border",
              depth < INDENT_LEVELS ? "ml-1 pl-3 md:ml-2 md:pl-6" : "pl-1"
            )}
            aria-label={`Under ${nodeTitle(node, map.format)}`}
          >
            {children.map((c) => draw(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };
  return (
    <ul className="space-y-3" aria-label={label}>
      {sorted(drawn.roots).map((n) => draw(n, 0))}
    </ul>
  );
}
