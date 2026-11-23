/**
 * Strategy Tree — tool-local actions.
 *
 * Category: Strategic Planning
 * Tool:     strategy as a tree you can test, in one of three shapes: DIBB
 *           (data, insight, belief, bet), a Lean Value Tree (vision, goals,
 *           bets, initiatives) or Hoshin Kanri (breakthrough objective,
 *           annual objectives, improvement priorities, targets).
 *
 * Agent surface: tool.strategy_tree.*
 *   1. list_state  — the trees: shape, root, counts per level and status,
 *                    whether all is agreed, the open checks, each part.
 *   2. create_tree — a new tree in a shape, from its root.
 *   3. add_node    — a part under its parent, the level from the parent.
 *   4. set_status  — proposed, agreed, has questions or dropped (with a note).
 *   5. send        — a bet or initiative to the Hypothesis Tracker, an
 *                    initiative or improvement priority to the roadmap.
 * Backing CRUD: workspace.strategy_map.* (formats dibb, lean-value-tree,
 * hoshin; the same entity holds the impact maps, which these verbs never
 * touch).
 *
 * The rules, levels, checks and sources are lib/strategy-map's, which the
 * page uses too; the store and the sends are ./_strategy-map's. History is
 * logged by the page, not here. Every verb works on the caller's own data.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import {
  STRATEGY_NODE_STATUSES,
  type StrategyMap,
  type StrategyMapNode,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { mapChecks } from "@/lib/strategy-map/checks";
import { TREE_FORMATS, isTreeFormat, levelHas, levelOf } from "@/lib/strategy-map/formats";
import {
  NODE_DETAIL_MAX,
  NODE_FIELD_MAX,
  NODE_TEXT_MAX,
  STRATEGY_NODES_MAX,
  becameAgreed,
  cleanText,
  levelCounts,
  newStrategyMap,
  newestFirst,
  withNode,
  withStatus,
} from "@/lib/strategy-map/model";
import {
  browserStrategyStore,
  linksOf,
  saveMap,
  sendNode,
  serverStrategyStore,
  type StrategyStore,
} from "./_strategy-map";

const TOOL = "tool.strategy_tree";
const isTree = (m: StrategyMap) => isTreeFormat(m.format);
type Out = Record<string, unknown>;

/* ── list_state ──────────────────────────────────────────────────────── */

async function listState(store: StrategyStore): Promise<Out> {
  const [all, hypotheses] = await Promise.all([store.maps(), store.hypotheses()]);
  const trees = newestFirst(all.filter(isTree));
  return {
    total: trees.filter((t) => !isExampleId(t.id)).length,
    examples: trees.filter((t) => isExampleId(t.id)).length,
    trees: await Promise.all(
      trees.map(async (t) => {
        const statuses = { proposed: 0, agreed: 0, questioned: 0, dropped: 0 };
        for (const n of t.nodes) statuses[n.status ?? "proposed"] += 1;
        const live = t.nodes.filter((n) => n.status !== "dropped");
        return {
          id: t.id,
          format: t.format,
          title: t.title,
          example: isExampleId(t.id),
          levels: [0, 1, 2, 3].map((l) => levelOf(t.format, l).label),
          counts: levelCounts(t),
          statuses,
          agreed: live.length >= 2 && live.every((n) => n.status === "agreed"),
          checks: mapChecks(t, hypotheses).map((c) => c.text),
          nodes: await Promise.all(
            t.nodes.map(async (n) => ({
              id: n.id,
              parentId: n.parentId,
              level: n.level,
              text: n.text,
              ...(n.detail ? { detail: n.detail } : {}),
              ...(n.measure ? { measure: n.measure } : {}),
              ...(n.owner ? { owner: n.owner } : {}),
              status: n.status ?? "proposed",
              ...(n.note ? { note: n.note } : {}),
              ...(n.sentTo?.length ? { sentTo: await linksOf(store, n.sentTo) } : {}),
            }))
          ),
          updatedAt: t.updatedAt,
        };
      })
    ),
  };
}

registry.register({
  id: `${TOOL}.list_state`,
  toolId: TOOL,
  name: "list_state",
  category: "read",
  description:
    "Summarise the strategy trees, newest first. Returns {total (examples left out), examples, trees: [{id, format ('dibb' | 'lean-value-tree' | 'hoshin'), title, example, levels: the four level names (0 the root), counts: parts per level, statuses: {proposed, agreed, questioned, dropped}, agreed (every part not dropped is agreed), checks: string[] (what the tree still misses), nodes: [{id, parentId, level, text, detail?, measure?, owner?, status, note?, sentTo?: [{route, targetId, at, target: 'live' | 'done' | 'gone'}]}], updatedAt}]}. Impact maps live in tool.impact_map.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStrategyStore),
  mcpHandler: async (_p, ctx) => listState(serverStrategyStore(ctx.userId)),
});

/* ── create_tree ─────────────────────────────────────────────────────── */

const CreateSchema = z.object({
  format: z
    .enum(TREE_FORMATS)
    .describe(
      "dibb (data, insight, belief, bet), lean-value-tree (vision, goals, bets, initiatives) or hoshin (breakthrough objective, annual objectives, improvement priorities, targets)."
    ),
  root: z
    .string()
    .min(1)
    .max(NODE_TEXT_MAX)
    .describe(
      "The root: the data (DIBB), the vision (Lean Value Tree) or the breakthrough objective (Hoshin)."
    ),
  measure: z.string().max(NODE_FIELD_MAX).optional().describe("Not used at the root of any shape."),
  title: z.string().max(NODE_TEXT_MAX).optional().describe("Default: the root's text."),
});

async function createTree(store: StrategyStore, p: z.infer<typeof CreateSchema>): Promise<Out> {
  const root = cleanText(p.root, NODE_TEXT_MAX);
  if (!root) return { created: false, reason: "blank" };
  const map = newStrategyMap({
    id: `strategyMap_${nanoid(8)}`,
    rootId: nanoid(8),
    format: p.format,
    root,
    ...(p.measure ? { measure: p.measure } : {}),
    ...(p.title ? { title: p.title } : {}),
    now: new Date().toISOString(),
  });
  const saved = await saveMap(store, map, undefined);
  if (!saved.ok) return { created: false, reason: saved.reason, message: saved.message };
  return { created: true, id: map.id, rootId: map.nodes[0].id, format: map.format };
}

registry.register({
  id: `${TOOL}.create_tree`,
  toolId: TOOL,
  name: "create_tree",
  category: "write",
  requiresConfirmation: false,
  description:
    "Start a strategy tree in one shape from its root, which starts 'proposed'. A second Hoshin breakthrough objective is a second tree. Params: format, root, measure?, title?. Returns {created: true, id, rootId (to add parts under), format} or {created: false, reason: 'blank' | 'rules' | 'too_big', message?}.",
  paramsSchema: CreateSchema,
  handler: async (p) => createTree(browserStrategyStore, p),
  mcpHandler: async (p, ctx) => createTree(serverStrategyStore(ctx.userId), p),
});

/* ── add_node ────────────────────────────────────────────────────────── */

const AddSchema = z.object({
  treeId: z.string(),
  parentId: z.string().describe("The part it goes under; its level is the parent's + 1."),
  text: z.string().min(1).max(NODE_TEXT_MAX),
  measure: z.string().max(NODE_FIELD_MAX).optional(),
  owner: z.string().max(NODE_FIELD_MAX).optional(),
  status: z.enum(STRATEGY_NODE_STATUSES).optional().describe("Default proposed."),
});

async function addNode(store: StrategyStore, p: z.infer<typeof AddSchema>): Promise<Out> {
  const tree = (await store.maps()).find((m) => m.id === p.treeId && isTree(m));
  if (!tree) return { added: false, reason: "not_found" };
  const parent = tree.nodes.find((n) => n.id === p.parentId);
  if (!parent) return { added: false, reason: "parent_not_found" };
  if (isExampleId(tree.id)) return { added: false, reason: "example" };
  if (parent.level >= 3) {
    return {
      added: false,
      reason: "leaf",
      message: `A ${levelOf(tree.format, 3).label.toLowerCase()} holds nothing.`,
    };
  }
  if (tree.nodes.length >= STRATEGY_NODES_MAX) {
    return {
      added: false,
      reason: "full",
      message: `A tree holds at most ${STRATEGY_NODES_MAX} parts.`,
    };
  }
  const level = (parent.level + 1) as 1 | 2 | 3;
  const label = levelOf(tree.format, level).label;
  const text = cleanText(p.text, NODE_TEXT_MAX);
  if (!text) return { added: false, reason: "blank" };
  const measure = cleanText(p.measure, NODE_FIELD_MAX);
  const owner = cleanText(p.owner, NODE_FIELD_MAX);
  if (measure && !levelHas(tree.format, level, "measure")) {
    return {
      added: false,
      reason: "field_level",
      message: `A ${label.toLowerCase()} has no measure here.`,
    };
  }
  if (owner && !levelHas(tree.format, level, "owner")) {
    return {
      added: false,
      reason: "field_level",
      message: `A ${label.toLowerCase()} has no owner here.`,
    };
  }
  const node: StrategyMapNode = {
    id: nanoid(8),
    parentId: parent.id,
    level,
    text,
    ...(measure ? { measure } : {}),
    ...(owner ? { owner } : {}),
    status: p.status ?? "proposed",
  };
  const saved = await saveMap(store, withNode(tree, node), tree);
  if (!saved.ok) return { added: false, reason: saved.reason, message: saved.message };
  return { added: true, id: node.id, level, kind: label };
}

registry.register({
  id: `${TOOL}.add_node`,
  toolId: TOOL,
  name: "add_node",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a part under another on a strategy tree; its level is the parent's + 1 (DIBB: insight, belief, bet; Lean Value Tree: goal, bet, initiative; Hoshin: annual objective, improvement priority, target). A measure only where the level has one (a DIBB bet; a Lean Value Tree goal, bet or initiative; a Hoshin annual objective or target), an owner only on a Lean Value Tree initiative or a Hoshin priority or target. Params: treeId, parentId, text, measure?, owner?, status? (default proposed). Returns {added: true, id, level, kind} or {added: false, reason: 'not_found' | 'parent_not_found' | 'example' | 'leaf' | 'full' | 'blank' | 'field_level' | 'rules' | 'too_big', message?}.",
  paramsSchema: AddSchema,
  handler: async (p) => addNode(browserStrategyStore, p),
  mcpHandler: async (p, ctx) => addNode(serverStrategyStore(ctx.userId), p),
});

/* ── set_status ──────────────────────────────────────────────────────── */

const StatusSchema = z.object({
  treeId: z.string(),
  nodeId: z.string(),
  status: z.enum(STRATEGY_NODE_STATUSES),
  note: z
    .string()
    .max(NODE_DETAIL_MAX)
    .optional()
    .describe("The question or the answer, for 'questioned' (Hoshin's catchball); '' removes it."),
});

async function setStatus(store: StrategyStore, p: z.infer<typeof StatusSchema>): Promise<Out> {
  const tree = (await store.maps()).find((m) => m.id === p.treeId && isTree(m));
  if (!tree) return { updated: false, reason: "not_found" };
  if (isExampleId(tree.id)) return { updated: false, reason: "example" };
  const node = tree.nodes.find((n) => n.id === p.nodeId);
  if (!node) return { updated: false, reason: "node_not_found" };
  const next = withStatus(tree, node.id, p.status, p.note);
  const saved = await saveMap(store, next, tree);
  if (!saved.ok) return { updated: false, reason: saved.reason, message: saved.message };
  return {
    updated: true,
    status: p.status,
    previous: node.status ?? "proposed",
    treeAgreed: becameAgreed(tree, next),
  };
}

registry.register({
  id: `${TOOL}.set_status`,
  toolId: TOOL,
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark a part of a strategy tree proposed, agreed, questioned ('Has questions', with the question as its note: Hoshin's catchball) or dropped. Params: treeId, nodeId, status, note?. Returns {updated: true, status, previous, treeAgreed (this change made every part not dropped agreed)} or {updated: false, reason: 'not_found' | 'example' | 'node_not_found' | 'rules' | 'too_big'}.",
  paramsSchema: StatusSchema,
  handler: async (p) => setStatus(browserStrategyStore, p),
  mcpHandler: async (p, ctx) => setStatus(serverStrategyStore(ctx.userId), p),
});

/* ── send ────────────────────────────────────────────────────────────── */

const SendSchema = z.object({
  treeId: z.string(),
  nodeId: z.string(),
  to: z
    .enum(["hypothesis", "epic"])
    .describe(
      "hypothesis: a DIBB bet, or a Lean Value Tree bet or initiative, to test in the Hypothesis Tracker. epic: a Lean Value Tree initiative or a Hoshin improvement priority, onto the Epic Roadmap next quarter."
    ),
});

registry.register({
  id: `${TOOL}.send`,
  toolId: TOOL,
  name: "send",
  category: "write",
  requiresConfirmation: false,
  description:
    "Send a part of a strategy tree on, as the page does: a bet to test as a drafted hypothesis (we believe the belief or bet above it, we'll do the bet or its initiatives, measured by its measure), or an initiative or priority onto the roadmap as an epic ('Part of: …' and its owner). Linked both ways ('From strategy tree'); once per route while that item exists; never an example or a dropped part. Params: treeId, nodeId, to. Returns {sent: true, route, targetId, title} or {sent: false, reason: 'not_found' | 'example' | 'level' | 'already_sent' (with targetId) | 'blank' | 'too_big', message?}.",
  paramsSchema: SendSchema,
  handler: async (p) =>
    sendNode(browserStrategyStore, { mapId: p.treeId, nodeId: p.nodeId, route: p.to }, isTree),
  mcpHandler: async (p, ctx) =>
    sendNode(
      serverStrategyStore(ctx.userId),
      { mapId: p.treeId, nodeId: p.nodeId, route: p.to },
      isTree
    ),
});
