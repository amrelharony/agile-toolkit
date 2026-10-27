/**
 * Opportunity Solution Tree — tool-local actions.
 *
 * Category: Product Discovery (squad S5)
 * Tool:     Outcome → opportunities (nested) → solutions → experiments
 *           (Teresa Torres).
 *
 * Agent surface: tool.opportunity_tree.*
 * Backing CRUD : workspace.opportunity_tree.* (auto-generated). Singleton: one
 *                OpportunityTree document (nodes[]) under a fixed id.
 *
 *   1. list_state                     — counts by kind, each outcome's target,
 *                                       and every experiment's test.
 *   2. add_node                       — add a node where its kind may go
 *                                       (CHILD_KINDS, ROOT_KINDS).
 *   3. set_target                     — mark the opportunity pursued under
 *                                       its outcome (one per outcome).
 *   4. remove_node                    — remove a node and everything under it.
 *   5. send_experiment_to_hypothesis  — test an experiment as a drafted
 *                                       hypothesis, linked both ways (once).
 *
 * The kinds, the target and the hypothesis an experiment hands over come
 * from lib/opportunity-tree, which the page uses too. Entity kinds
 * "workspace:opportunityTree" and "workspace:hypothesisTracker" (the fixed
 * OPPORTUNITY_TREE_ID and HYPOTHESIS_TRACKER_ID) match the browser sync and
 * the generic CRUD.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import type { ActionContext } from "../context";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type {
  HandoffLink,
  HypothesisTracker,
  OpportunityTree,
  TreeNode,
  TreeNodeKind,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  CHILD_KINDS,
  NODE_KINDS,
  NODE_TEXT_MAX,
  OPPORTUNITY_TREE_ID,
  ROOT_KINDS,
  canParent,
  experimentHypothesisSource,
  nodeTitle,
  outcomeOf,
  subtreeIds,
  withTarget,
  withoutSubtree,
} from "@/lib/opportunity-tree/model";
import {
  HYPOTHESIS_TRACKER_ID,
  hypothesisFromSource,
  hypothesisLink,
  linkedTest,
  missingFields,
  withHypothesis,
} from "@/lib/hypotheses/model";

/** MUST match registerCollection("opportunityTree", …) in workspace-store.ts. */
const KIND_OT = "workspace:opportunityTree";
/** MUST match registerCollection("hypothesisTracker", …) in workspace-store.ts. */
const KIND_HT = "workspace:hypothesisTracker";

const KindSchema = z.enum(NODE_KINDS);

const ws = () => useWorkspaceStore.getState();

/* ── The store adapter ───────────────────────────────────────────────── */

interface TreeStore {
  tree(): Promise<OpportunityTree | null>;
  put(doc: OpportunityTree): Promise<void>;
  tracker(): Promise<HypothesisTracker | null>;
  putTracker(doc: HypothesisTracker): Promise<void>;
}

const browserStore: TreeStore = {
  tree: async () => (ws().opportunityTrees ?? []).find((d) => d.id === OPPORTUNITY_TREE_ID) ?? null,
  put: async (doc) => ws().upsertOpportunityTree(doc),
  tracker: async () =>
    (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID) ?? null,
  putTracker: async (doc) => ws().upsertHypothesisTracker(doc),
};

function serverStore(userId: string): TreeStore {
  return {
    tree: async () =>
      (await serverGetEntity<OpportunityTree>(userId, KIND_OT, OPPORTUNITY_TREE_ID)) ?? null,
    put: async (doc) => {
      await serverUpsertEntity<OpportunityTree>(userId, KIND_OT, doc);
    },
    tracker: async () =>
      (await serverGetEntity<HypothesisTracker>(userId, KIND_HT, HYPOTHESIS_TRACKER_ID)) ?? null,
    putTracker: async (doc) => {
      await serverUpsertEntity<HypothesisTracker>(userId, KIND_HT, doc);
    },
  };
}

const withNodes = (doc: OpportunityTree | null, nodes: TreeNode[]): OpportunityTree => ({
  ...(doc ?? {}),
  id: OPPORTUNITY_TREE_ID,
  nodes,
});

/** "an outcome", "a solution". */
const aKind = (kind: TreeNodeKind) =>
  `${kind === "outcome" || kind === "opportunity" || kind === "experiment" ? "an" : "a"} ${kind}`;

/* ── list_state ──────────────────────────────────────────────────────── */

function summarize(doc: OpportunityTree | null, tracker: HypothesisTracker | null) {
  const nodes = doc?.nodes ?? [];
  const hypotheses = tracker?.hypotheses ?? [];
  const byKind: Record<TreeNodeKind, number> = {
    outcome: 0,
    opportunity: 0,
    solution: 0,
    experiment: 0,
  };
  for (const n of nodes) if (n.kind in byKind) byKind[n.kind] += 1;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    exists: doc !== null,
    total: nodes.length,
    byKind,
    targets: nodes
      .filter((n) => n.kind === "opportunity" && n.target)
      .map((n) => ({ id: n.id, text: nodeTitle(n), outcomeId: outcomeOf(n, byId)?.id ?? null })),
    nodes: nodes.map((n) =>
      n.kind === "experiment" ? { ...n, test: linkedTest(n.sentTo, hypotheses) } : n
    ),
  };
}

registry.register({
  id: "tool.opportunity_tree.list_state",
  toolId: "tool.opportunity_tree",
  name: "list_state",
  category: "read",
  description:
    "Summarise the opportunity solution tree. Returns {exists, total, byKind: {outcome, opportunity, solution, experiment}, targets: [{id, text, outcomeId (null: under no outcome)}] (the opportunity pursued under each outcome), nodes: each stored node ({id, kind, text, parentId, evidence?, description?, target?, sentTo?, sourceRef?}; an experiment also has test: {state: 'none'} | {state: 'testing', hypothesisId, status} | {state: 'tested', hypothesisId, result})}. An opportunity with sourceRef.tool 'user-interviews' was raised from an interview quote.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.tree(), await browserStore.tracker()),
  mcpHandler: async (_params, ctx) => {
    const store = serverStore(ctx.userId);
    const [doc, tracker] = await Promise.all([store.tree(), store.tracker()]);
    return summarize(doc, tracker);
  },
});

/* ── add_node ────────────────────────────────────────────────────────── */

const AddSchema = z.object({
  kind: KindSchema,
  text: z.string().min(1).max(NODE_TEXT_MAX),
  parentId: z.string().nullable().optional(),
  evidence: z.string().max(NODE_TEXT_MAX).optional(),
  description: z.string().max(NODE_TEXT_MAX).optional(),
});

async function addNode(store: TreeStore, p: z.infer<typeof AddSchema>) {
  const doc = await store.tree();
  const nodes = doc?.nodes ?? [];
  const parentId = p.parentId ?? null;
  const parent = parentId === null ? null : nodes.find((n) => n.id === parentId);
  if (parent === undefined) return { added: false, reason: "parent_not_found" };
  if (!canParent(parent, p.kind)) {
    const fits = parent ? CHILD_KINDS[parent.kind] : ROOT_KINDS;
    const what = aKind(p.kind);
    return {
      added: false,
      reason: "kind",
      message: `${what[0].toUpperCase()}${what.slice(1)} can't go ${
        parent ? `under ${aKind(parent.kind)}` : "at the root"
      }; ${fits.length > 0 ? `only ${fits.map(aKind).join(" or ")} can` : "nothing goes there"}.`,
    };
  }
  const node: TreeNode = {
    id: crypto.randomUUID(),
    kind: p.kind,
    text: p.text,
    parentId,
    ...(p.evidence ? { evidence: p.evidence } : {}),
    ...(p.description ? { description: p.description } : {}),
  };
  await store.put(withNodes(doc, [...nodes, node]));
  return { added: true, id: node.id };
}

// kind is outcome | opportunity | solution | experiment. A node goes where
// its kind may: an outcome or an opportunity at the root, an opportunity
// under an outcome or another opportunity, a solution under an
// opportunity, an experiment under a solution. Additive → no confirm.
registry.register({
  id: "tool.opportunity_tree.add_node",
  toolId: "tool.opportunity_tree",
  name: "add_node",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a node to the tree where its kind may go: at the root (parentId omitted/null) an outcome or an opportunity (one under no outcome); under an outcome, an opportunity; under an opportunity, a smaller opportunity or a solution; under a solution, an experiment. Text up to 2000 characters. Returns {added: true, id} or {added: false, reason: 'parent_not_found' | 'kind', message?}.",
  paramsSchema: AddSchema,
  handler: async (params) => addNode(browserStore, params),
  mcpHandler: async (params, ctx) => addNode(serverStore(ctx.userId), params),
});

/* ── set_target ──────────────────────────────────────────────────────── */

const TargetSchema = z.object({
  nodeId: z.string(),
  on: z.boolean().describe("true marks it its outcome's target; false unmarks it."),
});

async function setTarget(store: TreeStore, p: z.infer<typeof TargetSchema>) {
  const doc = await store.tree();
  const nodes = doc?.nodes ?? [];
  const node = nodes.find((n) => n.id === p.nodeId);
  if (!doc || !node) return { updated: false, reason: "not_found" };
  if (node.kind !== "opportunity") return { updated: false, reason: "not_opportunity" };
  const next = withTarget(nodes, p.nodeId, p.on);
  const cleared = nodes
    .filter((n) => n.id !== p.nodeId && n.target && !next.find((x) => x.id === n.id)?.target)
    .map((n) => n.id);
  await store.put(withNodes(doc, next));
  return { updated: true, target: p.on, cleared };
}

registry.register({
  id: "tool.opportunity_tree.set_target",
  toolId: "tool.opportunity_tree",
  name: "set_target",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark an opportunity as the one the team pursues under its outcome (on: true), or unmark it (on: false). An outcome has at most one target: marking one clears the others under the same outcome (the opportunities under no outcome count as one group). Returns {updated: true, target, cleared: string[] (ids no longer the target)} or {updated: false, reason: 'not_found' | 'not_opportunity'}.",
  paramsSchema: TargetSchema,
  handler: async (params) => setTarget(browserStore, params),
  mcpHandler: async (params, ctx) => setTarget(serverStore(ctx.userId), params),
});

/* ── remove_node ─────────────────────────────────────────────────────── */

async function removeNode(store: TreeStore, nodeId: string, ctx: ActionContext) {
  const doc = await store.tree();
  const nodes = doc?.nodes ?? [];
  const node = nodes.find((n) => n.id === nodeId);
  if (!doc || !node) return { removed: false, reason: "not_found" };
  const ids = subtreeIds(nodes, nodeId);
  if (ctx.confirm) {
    const below = ids.size - 1;
    const ok = await ctx.confirm(
      `Remove ${aKind(node.kind)} "${nodeTitle(node)}"${
        below > 0 ? ` and the ${below} node${below === 1 ? "" : "s"} under it` : ""
      }? An agent's remove can't be undone.`
    );
    if (!ok) return { removed: false, confirmed: false };
  }
  await store.put(withNodes(doc, withoutSubtree(nodes, nodeId)));
  return {
    removed: true,
    ids: nodes.filter((n) => ids.has(n.id)).map((n) => n.id),
    count: ids.size,
  };
}

registry.register({
  id: "tool.opportunity_tree.remove_node",
  toolId: "tool.opportunity_tree",
  name: "remove_node",
  category: "write",
  requiresConfirmation: true,
  description:
    "Remove a node and everything under it, as the page's delete does. Final for an agent (the page offers Undo): confirm with the user first, naming how many nodes go. A JTBD job linked to a removed opportunity then reads 'Opportunity removed'; a hypothesis sent from a removed experiment stays in the tracker. Params: nodeId. Returns {removed: true, ids, count} or {removed: false, reason: 'not_found'} or {removed: false, confirmed: false}.",
  paramsSchema: z.object({ nodeId: z.string() }),
  handler: async (params, ctx) => removeNode(browserStore, params.nodeId, ctx),
  mcpHandler: async (params, ctx) => removeNode(serverStore(ctx.userId), params.nodeId, ctx),
});

/* ── send_experiment_to_hypothesis ───────────────────────────────────── */

async function sendExperiment(store: TreeStore, nodeId: string) {
  const [doc, tracker] = await Promise.all([store.tree(), store.tracker()]);
  const nodes = doc?.nodes ?? [];
  const node = nodes.find((n) => n.id === nodeId);
  if (!doc || !node) return { sent: false, reason: "not_found" };
  if (node.kind !== "experiment") return { sent: false, reason: "not_experiment" };
  if (isExampleId(node.id)) return { sent: false, reason: "example" };
  const hypotheses = tracker?.hypotheses ?? [];
  if (linkedTest(node.sentTo, hypotheses).state !== "none") {
    return {
      sent: false,
      reason: "already_sent",
      hypothesisId: hypothesisLink(node.sentTo)?.targetId,
    };
  }
  const src = experimentHypothesisSource(node, nodes);
  if (!src.title.trim()) return { sent: false, reason: "blank" };
  const h = hypothesisFromSource(src, nanoid(8), todayLocalISO());
  await store.putTracker(withHypothesis(tracker, h));
  const link: HandoffLink = { route: "hypothesis", targetId: h.id, at: new Date().toISOString() };
  await store.put(
    withNodes(
      doc,
      nodes.map((n) =>
        n.id === node.id
          ? { ...n, sentTo: [...(n.sentTo ?? []).filter((l) => l.route !== "hypothesis"), link] }
          : n
      )
    )
  );
  return { sent: true, hypothesisId: h.id, believe: h.believe, missing: missingFields(h) };
}

registry.register({
  id: "tool.opportunity_tree.send_experiment_to_hypothesis",
  toolId: "tool.opportunity_tree",
  name: "send_experiment_to_hypothesis",
  category: "write",
  requiresConfirmation: false,
  description:
    "Test an experiment as a drafted hypothesis in the Hypothesis Tracker, as the page does: we believe the solution it sits under (the experiment's own text when it has none), we'll do the experiment (its notes as the experiment field), to learn about the nearest opportunity above it; linked both ways. The tracker then needs the success metric before it runs: fill it, and a target, with tool.hypothesis_tracker.update_hypothesis. Once per experiment while that hypothesis exists. Params: nodeId. Returns {sent: true, hypothesisId, believe, missing} or {sent: false, reason: 'not_found' | 'not_experiment' | 'example' | 'already_sent' (with hypothesisId) | 'blank'}.",
  paramsSchema: z.object({ nodeId: z.string() }),
  handler: async (params) => sendExperiment(browserStore, params.nodeId),
  mcpHandler: async (params, ctx) => sendExperiment(serverStore(ctx.userId), params.nodeId),
});
