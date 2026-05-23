/**
 * Right-radiating Reingold-Tilford tree layout for mind maps.
 *
 * The standard RT algorithm produces a "tidy tree" where:
 *   - Sibling subtrees never overlap
 *   - The whole tree is as compact as possible while preserving 1
 *   - Each parent sits centred relative to its children
 *
 * We adapt it for canvas mind maps by:
 *   - Laying out children to the RIGHT of their parent (rather than
 *     vertically below, which is the academic-paper convention).
 *     Reads more naturally on widescreen canvases.
 *   - Anchoring the root's position at whatever the user dragged it
 *     to (so dragging the root doesn't reflow the whole map back to
 *     the origin).
 *   - Skipping collapsed subtrees entirely.
 *
 * Layout runs in pure data — given a list of nodes belonging to one
 * mind map, returns a new list with updated x/y positions. The caller
 * persists via the usual upsertMany flow.
 */

import type { WhiteboardMindMapNode } from "@/lib/stores/workspace-types";

const COL_GAP = 64;
const ROW_GAP = 18;

interface TreeNode {
  node: WhiteboardMindMapNode;
  children: TreeNode[];
  /** Height (in canvas px) of THIS node's subtree including row gaps. */
  subtreeHeight: number;
}

/**
 * Build a parent → children tree from a flat list of nodes belonging
 * to one mind map. Nodes whose parent isn't in the list (orphans) are
 * skipped — they shouldn't happen during steady state but defensive
 * filtering prevents runaway layouts if a delete races a child write.
 */
function buildTree(nodes: readonly WhiteboardMindMapNode[]): TreeNode | null {
  const byId = new Map<string, WhiteboardMindMapNode>();
  for (const n of nodes) byId.set(n.id, n);
  const root = nodes.find((n) => !n.parentNodeId);
  if (!root) return null;
  const childrenByParent = new Map<string, WhiteboardMindMapNode[]>();
  for (const n of nodes) {
    if (!n.parentNodeId) continue;
    if (!byId.has(n.parentNodeId)) continue; // orphan
    if (!childrenByParent.has(n.parentNodeId)) childrenByParent.set(n.parentNodeId, []);
    childrenByParent.get(n.parentNodeId)!.push(n);
  }
  // Stable child order: sort by createdAt so newly-added children
  // land at the bottom of their parent's list rather than scrambling
  // the existing tree on every add.
  const visit = (n: WhiteboardMindMapNode): TreeNode => {
    const directChildren = (childrenByParent.get(n.id) ?? []).slice().sort(
      (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
    );
    const kids = n.collapsed ? [] : directChildren.map(visit);
    const ownHeight = n.h;
    const childrenHeight = kids.length === 0
      ? 0
      : kids.reduce((sum, c, i) => sum + c.subtreeHeight + (i > 0 ? ROW_GAP : 0), 0);
    const subtreeHeight = Math.max(ownHeight, childrenHeight);
    return { node: n, children: kids, subtreeHeight };
  };
  return visit(root);
}

/**
 * Recursively assign x/y to every node in the tree.
 *
 * Caller passes the world position the ROOT should occupy; descendants
 * cascade rightward from there.
 *
 * Returns a map of node-id → { x, y } so the caller can build a patch.
 */
function place(
  root: TreeNode,
  rootX: number,
  rootY: number,
  out: Map<string, { x: number; y: number }>,
): void {
  const walk = (t: TreeNode, x: number, centreY: number) => {
    // The node's TOP-LEFT corner — centre Y minus half the node's
    // own height so its centre lines up with the supplied centreY.
    out.set(t.node.id, { x, y: centreY - t.node.h / 2 });
    if (t.children.length === 0) return;
    const childX = x + t.node.w + COL_GAP;
    // Children stack vertically; their CENTRES are determined by
    // dividing the subtree's total height. First child's centre is
    // at the TOP of the children block; subsequent children shift
    // down by half-prev + ROW_GAP + half-next.
    let cursorTop = centreY - childrenSubtreeHeight(t) / 2;
    for (const child of t.children) {
      const childCentre = cursorTop + child.subtreeHeight / 2;
      walk(child, childX, childCentre);
      cursorTop += child.subtreeHeight + ROW_GAP;
    }
  };
  walk(root, rootX, rootY + root.node.h / 2);
}

function childrenSubtreeHeight(t: TreeNode): number {
  if (t.children.length === 0) return 0;
  return t.children.reduce(
    (sum, c, i) => sum + c.subtreeHeight + (i > 0 ? ROW_GAP : 0),
    0,
  );
}

/**
 * Compute new positions for every node in a mind map.
 *
 * Pass the FULL list of nodes belonging to ONE mind map (filter by
 * `mindMapId` upstream) and the desired root position (typically the
 * root node's current x/y, so dragging the root doesn't unanchor the
 * layout). Returns a map of node-id → new top-left coords.
 *
 * Nodes whose position didn't change are still included in the map.
 * The caller is responsible for diffing and skipping no-op updates
 * to avoid bloating the undo stack.
 */
export function layoutMindMap(
  nodes: readonly WhiteboardMindMapNode[],
  rootAnchor: { x: number; y: number } | null,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const root = buildTree(nodes);
  if (!root) return out;
  // If the caller didn't supply an anchor, keep the root where it is.
  const anchor = rootAnchor ?? { x: root.node.x, y: root.node.y };
  place(root, anchor.x, anchor.y, out);
  return out;
}

/** Default size for a new mind-map node. */
export const MIND_MAP_NODE_DEFAULT = { w: 180, h: 56 } as const;

/**
 * True when `descendantId` appears anywhere in the subtree rooted at
 * `ancestorId`. Used to prevent the drag-to-reparent flow from
 * letting a node become its own descendant (which would create a
 * cycle and either infinite-loop the layout or crash it).
 *
 * Iterative BFS rather than recursive so it can't blow the stack on
 * a pathological-but-not-impossible 10k-node tree.
 */
export function isMindMapDescendant(
  ancestorId: string,
  descendantId: string,
  nodes: readonly WhiteboardMindMapNode[],
): boolean {
  if (ancestorId === descendantId) return true;
  const childrenByParent = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentNodeId) continue;
    if (!childrenByParent.has(n.parentNodeId)) childrenByParent.set(n.parentNodeId, []);
    childrenByParent.get(n.parentNodeId)!.push(n.id);
  }
  const queue: string[] = [ancestorId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === descendantId) return true;
    const kids = childrenByParent.get(id);
    if (kids) queue.push(...kids);
  }
  return false;
}
