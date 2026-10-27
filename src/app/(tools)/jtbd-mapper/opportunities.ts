import { isExampleId } from "@/components/tool-frame/example-data";
import {
  OPPORTUNITY_TREE_ID,
  type JobStory,
  type OpportunityTree,
  type TreeNode,
} from "@/lib/stores/workspace-types";

/**
 * A job can name the Opportunity Tree opportunity it serves
 * (`JobStory.opportunityId`), so discovery and the job map stay connected:
 * the tree says which customer need is worth pursuing, the job says the
 * moment it shows up in. The link is an id, never a copy of the text, so a
 * renamed opportunity reads right here at once.
 */

/** The tree's one document: defined with the workspace types since Phase 8, re-exported for JTBD's callers. */
export { OPPORTUNITY_TREE_ID };

/** Where the link chip and the "no opportunities yet" pointer go. */
export const OPPORTUNITY_TREE_HREF = "/opportunity-tree";

/** The group for opportunities that sit under no outcome (a hand-edited or agent-made tree). */
export const NO_OUTCOME = "Not under an outcome";

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
  const seen = new Set<string>([node.id]);
  let cur = node.parentId ? byId.get(node.parentId) : undefined;
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === "outcome") return cur;
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return undefined;
}

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

/** The ids a job may link to (the add form checks its pick against them). */
export function opportunityIds(groups: readonly OpportunityGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => g.options.map((o) => o.id)));
}

export type OpportunityLink =
  | { state: "none" }
  | { state: "linked"; id: string; title: string; outcome?: string }
  /** The node was deleted in the tree: the id stays until the user unlinks it. */
  | { state: "missing"; id: string };

/**
 * How a job's link stands. A deleted node is not unlinked behind the
 * user's back: the row says "Opportunity removed" and offers Unlink, and a
 * node put back in the tree (an import, an agent) links up again.
 */
export function resolveOpportunity(
  job: Pick<JobStory, "opportunityId">,
  byId: ReadonlyMap<string, TreeNode>
): OpportunityLink {
  const id = job.opportunityId;
  if (!id) return { state: "none" };
  const node = byId.get(id);
  if (!node) return { state: "missing", id };
  const outcome = outcomeOf(node, byId);
  return {
    state: "linked",
    id,
    title: nodeTitle(node),
    ...(outcome ? { outcome: nodeTitle(outcome) } : {}),
  };
}

/** The job without its link; no empty key is left behind. */
export function withoutOpportunity(job: JobStory): JobStory {
  const next = { ...job };
  delete next.opportunityId;
  return next;
}
