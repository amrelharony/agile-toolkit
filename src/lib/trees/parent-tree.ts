/**
 * Trees kept as a flat list of nodes, each naming its parent (`parentId`,
 * null at the top): the Opportunity Tree's nodes and a strategy map's
 * (Impact Map, Strategy Tree). How such a tree is drawn, and what a delete
 * takes with it, in one place. Generic over `{id, parentId}`, so each tool
 * keeps its own node type. Pure and server-safe: no React, no store.
 */

/** What a node of a parent-linked tree has: its id and its parent's (null at the top). */
export interface ParentLinked {
  id: string;
  parentId: string | null;
}

/* ── The tree as drawn ───────────────────────────────────────────────── */

export interface DrawnParentTree<T extends ParentLinked> {
  /** The nodes drawn at the top: no parent, a parent that is gone, or cut off by a cycle. */
  roots: T[];
  childrenOf: (id: string) => T[];
}

/**
 * The tree for drawing, in stored order. A node whose parent isn't on the
 * tree (an agent's or an import's) is drawn at the top rather than lost,
 * and so is a node a hand-edited cycle would hide.
 */
export function drawTree<T extends ParentLinked>(nodes: readonly T[]): DrawnParentTree<T> {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const n of nodes) {
    if (n.parentId && n.parentId !== n.id && ids.has(n.parentId)) {
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
    } else roots.push(n);
  }
  // Anything a cycle cuts off from every root is drawn at the top too.
  const seen = new Set<string>();
  const visit = (start: T) => {
    const stack = [start];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      stack.push(...(children.get(n.id) ?? []));
    }
  };
  roots.forEach(visit);
  for (const n of nodes) {
    if (!seen.has(n.id)) {
      roots.push(n);
      visit(n);
    }
  }
  return { roots, childrenOf: (id) => children.get(id) ?? [] };
}

/* ── Removing ────────────────────────────────────────────────────────── */

/**
 * The node and everything under it. Safe on a hand-edited tree whose
 * parent links form a cycle. Empty for an unknown id.
 */
export function subtreeIds<T extends ParentLinked>(nodes: readonly T[], id: string): Set<string> {
  if (!nodes.some((n) => n.id === id)) return new Set();
  const ids = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** The tree without the node `id` and everything under it (a page's delete, a remove verb). */
export function withoutSubtree<T extends ParentLinked>(nodes: readonly T[], id: string): T[] {
  const gone = subtreeIds(nodes, id);
  return nodes.filter((n) => !gone.has(n.id));
}

/**
 * The tree without the node `id` alone: its children move up to its
 * parent (the root when it had none), so nothing added under it in the
 * meantime is lost. A child may then sit under a node that wouldn't take
 * it from the menu; the page shows it as it is.
 */
export function withoutNode<T extends ParentLinked>(nodes: readonly T[], id: string): T[] {
  const node = nodes.find((n) => n.id === id);
  if (!node) return [...nodes];
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.parentId === id ? { ...n, parentId: node.parentId } : n));
}
