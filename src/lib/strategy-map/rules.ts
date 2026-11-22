/**
 * The rules a strategy map (Impact Map, Strategy Tree) keeps, checked on
 * every workspace.strategy_map write: the CRUD refuses a write that breaks
 * one, naming each problem. Pure; the tools may add checks, never rename.
 */

import type { StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";

/** The deepest level a node can sit at. */
const LAST_LEVEL = 3;

const list = (nodes: readonly StrategyMapNode[]) => nodes.map((n) => n.id).join(", ");

/**
 * Each problem with `next`, one plain sentence each, naming the nodes and
 * how to fix them; empty when it keeps every rule. `current` is the stored
 * map on an update (undefined on a create).
 */
export function strategyMapProblems(next: StrategyMap, current: StrategyMap | undefined): string[] {
  const problems: string[] = [];
  if (current && current.format !== next.format) {
    problems.push(
      `A map keeps its format: this one is ${current.format}, not ${next.format}. Make a new map instead.`
    );
  }

  const nodes = next.nodes ?? [];
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) repeated.add(node.id);
    seen.add(node.id);
  }
  if (repeated.size > 0) {
    problems.push(
      `Node ids repeat (${Array.from(repeated).join(", ")}). Give each node its own id.`
    );
  }

  if (nodes.length > 0) {
    const roots = nodes.filter((n) => n.parentId === null);
    if (roots.length !== 1 || roots[0].level !== 0) {
      problems.push(
        roots.length === 0
          ? "A map needs one root: a node at level 0 with parentId null. It has none."
          : `A map has one root, a node at level 0 with parentId null. These are roots: ${roots
              .map((r) => `${r.id} (level ${r.level})`)
              .join(", ")}.`
      );
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const parent = byId.get(node.parentId);
    if (!parent) {
      problems.push(
        `Node ${node.id}'s parent ${node.parentId} isn't on the map. Point it at a node that is, or remove it.`
      );
    } else if (parent.level >= LAST_LEVEL) {
      problems.push(
        `Node ${node.id} sits under ${parent.id}, which is at level ${LAST_LEVEL}, the last level: nothing goes under it.`
      );
    } else if (node.level !== parent.level + 1) {
      problems.push(
        `Node ${node.id} is at level ${node.level}, but its parent ${parent.id} is at level ${parent.level}: a node sits one level below its parent.`
      );
    }
  }

  const impactMap = next.format === "impact-map";
  const strayPersonas = nodes.filter(
    (n) => n.personaId !== undefined && !(impactMap && n.level === 1)
  );
  if (strayPersonas.length > 0) {
    problems.push(
      `Only an impact map's actors (level 1) link a persona: remove personaId from ${list(strayPersonas)}.`
    );
  }
  const focused = nodes.filter((n) => n.focus === true);
  const strayFocus = focused.filter((n) => !(impactMap && n.level === 2));
  if (strayFocus.length > 0) {
    problems.push(
      `Only an impact map's impacts (level 2) can be its focus: remove focus from ${list(strayFocus)}.`
    );
  }
  const focusedImpacts = focused.filter((n) => impactMap && n.level === 2);
  if (focusedImpacts.length > 1) {
    problems.push(
      `An impact map has one focus impact, but ${list(focusedImpacts)} are all marked. Keep one.`
    );
  }
  if (impactMap) {
    const marked = nodes.filter((n) => n.status !== undefined || n.note !== undefined);
    if (marked.length > 0) {
      problems.push(
        `An impact map's nodes have no status or note (a strategy tree's): remove them from ${list(marked)}.`
      );
    }
  }
  return problems;
}
