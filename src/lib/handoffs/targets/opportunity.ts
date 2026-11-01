/**
 * Hand-off target: an opportunity on the Opportunity Tree.
 *
 * Adds an opportunity node to the tree's document (`opportunityTree:
 * current`): the item's title is its text, its description the evidence,
 * and it goes under `src.parentId` when that node is in the tree and may
 * hold an opportunity (an outcome or another opportunity), else at the
 * root, where JTBD lists it as "Not under an outcome". Keeps `sourceRef`
 * (an interview quote: User Interviews sends its redacted text and never
 * the participant's name).
 *
 * Undo takes the node out alone: anything added under it in the meantime
 * moves up to its parent rather than going with it. The node itself is
 * built by lib/opportunity-tree/model (opportunityFromSource), which the
 * agent actions call on the server too.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { OpportunityTree, TreeNode } from "@/lib/stores/workspace-types";
import {
  OPPORTUNITY_TREE_ID,
  opportunityFromSource,
  withoutNode,
} from "@/lib/opportunity-tree/model";
import type { HandoffRoute } from "../types";

export function currentOpportunityTree(): OpportunityTree | undefined {
  return (useWorkspaceStore.getState().opportunityTrees ?? []).find(
    (d) => d.id === OPPORTUNITY_TREE_ID
  );
}

function save(nodes: TreeNode[]): void {
  useWorkspaceStore
    .getState()
    .upsertOpportunityTree({ ...(currentOpportunityTree() ?? {}), id: OPPORTUNITY_TREE_ID, nodes });
}

const findNode = (id: string) => currentOpportunityTree()?.nodes.find((n) => n.id === id);

export const opportunityRoute: HandoffRoute = {
  id: "opportunity",
  label: "Opportunity",
  doneLabel: "Added as an opportunity",
  targetToolId: "opportunity-tree",
  targetHref: () => "/opportunity-tree",
  send: (src) => {
    const nodes = currentOpportunityTree()?.nodes ?? [];
    const node = opportunityFromSource(src, nodes, nanoid(8));
    // Appended, as the tree adds its own nodes.
    save([...nodes, node]);
    return node.id;
  },
  remove: (id) => {
    const nodes = currentOpportunityTree()?.nodes;
    if (!nodes || !nodes.some((n) => n.id === id)) return;
    save(withoutNode(nodes, id));
  },
  exists: (id) => Boolean(findNode(id)),
  // No isDone: an opportunity is pursued or dropped, never "finished".
};
