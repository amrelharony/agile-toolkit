import type { JobStory, TreeNode } from "@/lib/stores/workspace-types";
import { nodeTitle, outcomeOf, type OpportunityGroup } from "@/lib/opportunity-tree/model";

/**
 * A job can name the Opportunity Tree opportunity it serves
 * (`JobStory.opportunityId`), so discovery and the job map stay connected:
 * the tree says which customer need is worth pursuing, the job says the
 * moment it shows up in. The link is an id, never a copy of the text, so a
 * renamed opportunity reads right here at once.
 *
 * Reading the tree (its nodes, a node's title, the outcome it serves, the
 * grouped picker) lives with the tree since Phase 8, in the server-safe
 * lib/opportunity-tree/model, which the tree's agent actions and the
 * interview hand-off share; it is re-exported here for JTBD's callers.
 */

export {
  NO_OUTCOME,
  OPPORTUNITY_TREE_ID,
  nodeTitle,
  opportunityGroups,
  outcomeOf,
  treeNodes,
} from "@/lib/opportunity-tree/model";
export type { OpportunityGroup, OpportunityOption } from "@/lib/opportunity-tree/model";

/** Where the link chip and the "no opportunities yet" pointer go. */
export const OPPORTUNITY_TREE_HREF = "/opportunity-tree";

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
