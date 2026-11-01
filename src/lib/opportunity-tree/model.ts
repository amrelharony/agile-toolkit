/**
 * The Opportunity Solution Tree (Teresa Torres): an outcome, the
 * opportunities (customer needs) that serve it, nested as deep as the
 * team splits them, the solutions to an opportunity and the experiments
 * that test a solution.
 *
 * Which kind may sit under which (CHILD_KINDS, ROOT_KINDS) is one rule for
 * the page, tool.opportunity_tree and the "opportunity" hand-off, so an
 * agent can't put an outcome under an experiment. A target marks the
 * opportunity the team pursues: at most one per outcome. An experiment is
 * tested as a hypothesis; an interview quote can be raised as an
 * opportunity (lib/interviews).
 *
 * JTBD's job → opportunity links read the tree through treeNodes,
 * nodeTitle, outcomeOf and opportunityGroups (app/(tools)/jtbd-mapper/
 * opportunities re-exports them). Pure and server-safe: nothing here
 * imports a "use client" module, React or the store.
 */

import {
  OPPORTUNITY_TREE_ID,
  type OpportunityTree,
  type TreeNode,
  type TreeNodeKind,
} from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import { isExampleId } from "@/lib/utils/example-id";
import { believeLine } from "@/lib/hypotheses/model";

/** The tree's one document (the page, its agent actions, JTBD's links, the hand-off). */
export { OPPORTUNITY_TREE_ID };

/** A node's text, for the page, the agent and a hand-off. */
export const NODE_TEXT_MAX = 2000;

/** Every kind, in the tree's order from the top. */
export const NODE_KINDS = ["outcome", "opportunity", "solution", "experiment"] as const;

/**
 * The kinds a node may hold. An opportunity holds smaller opportunities
 * (a Torres tree splits a need into sub-needs) as well as solutions.
 */
export const CHILD_KINDS: Readonly<Record<TreeNodeKind, readonly TreeNodeKind[]>> = {
  outcome: ["opportunity"],
  opportunity: ["opportunity", "solution"],
  solution: ["experiment"],
  experiment: [],
};

/** The kinds that may stand at the root. A root opportunity is JTBD's "Not under an outcome". */
export const ROOT_KINDS: readonly TreeNodeKind[] = ["outcome", "opportunity"];

/** Whether a `kind` node may go under `parent` (null or undefined: the root). */
export function canParent(parent: TreeNode | null | undefined, kind: TreeNodeKind): boolean {
  if (!parent) return ROOT_KINDS.includes(kind);
  return (CHILD_KINDS[parent.kind] ?? []).includes(kind);
}

const EMPTY_NODES: readonly TreeNode[] = [];

/** The Opportunity Tree's nodes, or none while it hasn't been started. */
export function treeNodes(trees: readonly OpportunityTree[] | undefined): readonly TreeNode[] {
  return (trees ?? []).find((d) => d.id === OPPORTUNITY_TREE_ID)?.nodes ?? EMPTY_NODES;
}

/**
 * A node's title. The tree adds a node blank and lets you type into it, so
 * an untitled opportunity is common while mapping; it is still a real node
 * a job can point at, so it gets a name instead of an empty menu row.
 */
export function nodeTitle(node: Pick<TreeNode, "kind" | "text">): string {
  const text = (node.text ?? "").replace(/\s+/g, " ").trim();
  return text || `Untitled ${node.kind}`;
}

/**
 * The outcome a node serves: its nearest outcome ancestor, climbing past
 * nested opportunities. None for a node whose chain has no outcome, a
 * missing parent, or a hand-edited cycle.
 */
export function outcomeOf(
  node: TreeNode,
  byId: ReadonlyMap<string, TreeNode>
): TreeNode | undefined {
  return ancestorOfKind(node, byId, "outcome");
}

/** The nearest ancestor of `kind` (never the node itself); cycle-safe. */
function ancestorOfKind(
  node: TreeNode,
  byId: ReadonlyMap<string, TreeNode>,
  kind: TreeNodeKind
): TreeNode | undefined {
  const seen = new Set<string>([node.id]);
  let cur = node.parentId ? byId.get(node.parentId) : undefined;
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === kind) return cur;
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return undefined;
}

/** The group for opportunities that sit under no outcome (a hand-edited or agent-made tree). */
export const NO_OUTCOME = "Not under an outcome";

export interface OpportunityOption {
  id: string;
  title: string;
}

export interface OpportunityGroup {
  /** The outcome's node id; null for the opportunities under no outcome. */
  outcomeId: string | null;
  /** The outcome's title, for context: two outcomes can share an opportunity's wording. */
  outcome: string;
  options: OpportunityOption[];
}

/**
 * What a job can link to: the tree's opportunity nodes, grouped by the
 * outcome they serve, in the tree's own order (opportunities under no
 * outcome last). Example nodes are left out, so a job of the user's never
 * ends up pointing at data that "Clear example" removes.
 */
export function opportunityGroups(nodes: readonly TreeNode[]): OpportunityGroup[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const groups = new Map<string | null, OpportunityGroup>();
  for (const n of nodes) {
    if (n.kind !== "opportunity" || isExampleId(n.id)) continue;
    const outcome = outcomeOf(n, byId);
    const key = outcome?.id ?? null;
    let group = groups.get(key);
    if (!group) {
      group = { outcomeId: key, outcome: outcome ? nodeTitle(outcome) : NO_OUTCOME, options: [] };
      groups.set(key, group);
    }
    group.options.push({ id: n.id, title: nodeTitle(n) });
  }
  const rank = (g: OpportunityGroup) =>
    g.outcomeId === null ? Number.MAX_SAFE_INTEGER : (order.get(g.outcomeId) ?? 0);
  return Array.from(groups.values()).sort((a, b) => rank(a) - rank(b));
}

/* ── Removing ────────────────────────────────────────────────────────── */

/**
 * The node and everything under it. Safe on a hand-edited tree whose
 * parent links form a cycle. Empty for an unknown id.
 */
export function subtreeIds(nodes: readonly TreeNode[], id: string): Set<string> {
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

/** The tree without the node `id` and everything under it (the page's delete, remove_node). */
export function withoutSubtree(nodes: readonly TreeNode[], id: string): TreeNode[] {
  const gone = subtreeIds(nodes, id);
  return nodes.filter((n) => !gone.has(n.id));
}

/**
 * The tree without the node `id` alone: its children move up to its
 * parent (the root when it had none), so nothing added under it in the
 * meantime is lost. Undoing an "opportunity" hand-off uses this. A child
 * may then sit under a kind that wouldn't take it from the menu; the page
 * shows it as it is.
 */
export function withoutNode(nodes: readonly TreeNode[], id: string): TreeNode[] {
  const node = nodes.find((n) => n.id === id);
  if (!node) return [...nodes];
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.parentId === id ? { ...n, parentId: node.parentId } : n));
}

/* ── The target ──────────────────────────────────────────────────────── */

/**
 * The tree with the opportunity `id` marked as its outcome's target (`on`)
 * or not. Marking one clears the target from the other opportunities under
 * the same outcome (the opportunities under no outcome count as one
 * group). Anything but an opportunity is left alone.
 */
export function withTarget(nodes: readonly TreeNode[], id: string, on: boolean): TreeNode[] {
  const node = nodes.find((n) => n.id === id);
  if (!node || node.kind !== "opportunity") return [...nodes];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const group = outcomeOf(node, byId)?.id ?? null;
  const clear = (n: TreeNode): TreeNode => {
    if (!n.target) return n;
    const next = { ...n };
    delete next.target;
    return next;
  };
  return nodes.map((n) => {
    if (n.id === id) return on ? { ...n, target: true } : clear(n);
    if (on && n.target && n.kind === "opportunity" && (outcomeOf(n, byId)?.id ?? null) === group) {
      return clear(n);
    }
    return n;
  });
}

/** An outcome holding more than one target opportunity (outcomeId null: the opportunities under no outcome). */
export interface TargetClash {
  outcomeId: string | null;
  /** The target opportunities' ids, in the tree's order. */
  ids: string[];
}

/**
 * The outcomes with more than one target opportunity, grouped as withTarget
 * groups them (the opportunities under no outcome count as one group), in
 * the tree's order; empty when each has at most one. What a writer that
 * sets the nodes wholesale (the workspace.opportunity_tree CRUD, where a
 * re-parent can move a target under an outcome that has one) must not
 * leave behind.
 */
export function targetClashes(nodes: readonly TreeNode[]): TargetClash[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = new Map<string | null, string[]>();
  for (const n of nodes) {
    if (n.kind !== "opportunity" || !n.target) continue;
    const key = outcomeOf(n, byId)?.id ?? null;
    const ids = groups.get(key);
    if (ids) ids.push(n.id);
    else groups.set(key, [n.id]);
  }
  return Array.from(groups, ([outcomeId, ids]) => ({ outcomeId, ids })).filter(
    (g) => g.ids.length > 1
  );
}

/* ── Hand-offs ───────────────────────────────────────────────────────── */

/**
 * What testing an experiment hands to the Hypothesis Tracker: we believe
 * the solution it tests (the experiment's own text when it sits under no
 * solution), we'll do the experiment, and we learn about the nearest
 * opportunity above it. Its notes become the experiment field.
 */
export function experimentHypothesisSource(
  node: TreeNode,
  nodes: readonly TreeNode[]
): HandoffSource {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  const solution = parent?.kind === "solution" ? (parent.text ?? "").trim() : "";
  const opportunity = (ancestorOfKind(node, byId, "opportunity")?.text ?? "").trim();
  const willDo = (node.text ?? "").trim();
  const notes = (node.description ?? "").trim();
  return {
    title: believeLine(solution || willDo),
    ...(opportunity ? { description: opportunity } : {}),
    hypothesis: { ...(willDo ? { willDo } : {}), ...(notes ? { experiment: notes } : {}) },
    sourceRef: { tool: "opportunity-tree", id: node.id, doc: OPPORTUNITY_TREE_ID },
  };
}

/**
 * The opportunity node the "opportunity" hand-off adds: the source's title
 * (capped) as its text, under `src.parentId` when that node is in the tree
 * and may hold an opportunity (an outcome or an opportunity), else at the
 * root; the description becomes its evidence, and it keeps sourceRef.
 */
export function opportunityFromSource(
  src: HandoffSource,
  nodes: readonly TreeNode[],
  id: string
): TreeNode {
  const parent = src.parentId ? nodes.find((n) => n.id === src.parentId) : undefined;
  const evidence = (src.description ?? "").trim();
  return {
    id,
    kind: "opportunity",
    text: src.title.trim().slice(0, NODE_TEXT_MAX),
    parentId: parent && canParent(parent, "opportunity") ? parent.id : null,
    ...(evidence ? { evidence: evidence.slice(0, NODE_TEXT_MAX) } : {}),
    sourceRef: src.sourceRef,
  };
}
