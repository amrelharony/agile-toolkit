/**
 * Impact Map — tool-local actions.
 *
 * Category: Strategic Planning
 * Tool:     a goal (why), the actors who can move it (who), how each must
 *           act differently (impacts) and what the team could build or do
 *           (deliverables).
 *
 * Agent surface: tool.impact_map.*
 *   1. list_state       — the impact maps: goal, measure, date, the linked
 *                         Product Goal, counts per level, the focus, the
 *                         open checks and where each deliverable went.
 *   2. create_map       — a new map from a goal, or from the Product Goal.
 *   3. add_node         — an actor, an impact or a deliverable under its parent.
 *   4. set_focus        — the impact to work on first (or none).
 *   5. send_deliverable — a deliverable to the backlog or the roadmap.
 *   6. test_impact      — an impact to the Hypothesis Tracker.
 * Backing CRUD: workspace.strategy_map.* (format "impact-map"; the same
 * entity holds the Strategy Tree's trees, which these verbs never touch).
 *
 * The rules, checks and sources are lib/strategy-map's, which the page
 * uses too; the store and the sends are ./_strategy-map's. History is
 * logged by the page, not here. Every verb works on the caller's own data,
 * so a visitor's chat may offer it.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import {
  TOOL_TEXT_MAX,
  type ProductGoal,
  type StrategyMap,
  type StrategyMapNode,
} from "@/lib/stores/workspace-types";
import { activeGoal } from "@/lib/product-goal/model";
import { isExampleId } from "@/lib/utils/example-id";
import { isIsoDate } from "@/lib/sprints/calendar";
import { mapChecks } from "@/lib/strategy-map/checks";
import { levelHas } from "@/lib/strategy-map/formats";
import {
  NODE_DETAIL_MAX,
  NODE_TEXT_MAX,
  STRATEGY_NODES_MAX,
  cleanText,
  focusOf,
  levelCounts,
  newStrategyMap,
  newestFirst,
  withFocus,
  withNode,
} from "@/lib/strategy-map/model";
import {
  browserStrategyStore,
  linksOf,
  saveMap,
  sendNode,
  serverStrategyStore,
  type StrategyStore,
} from "./_strategy-map";

const TOOL = "tool.impact_map";
const isImpactMap = (m: StrategyMap) => m.format === "impact-map";
type Out = Record<string, unknown>;

/* ── list_state ──────────────────────────────────────────────────────── */

function goalState(map: StrategyMap, goals: readonly ProductGoal[]) {
  if (!map.productGoalId) return null;
  const g = goals.find((x) => x.id === map.productGoalId);
  return g ? { id: g.id, status: g.status } : { id: map.productGoalId, gone: true };
}

async function listState(store: StrategyStore): Promise<Out> {
  const [all, goals, hypotheses] = await Promise.all([
    store.maps(),
    store.goals(),
    store.hypotheses(),
  ]);
  const maps = newestFirst(all.filter(isImpactMap));
  const own = maps.filter((m) => !isExampleId(m.id));
  const totals = own.reduce(
    (t, m) => {
      const [, actors, impacts, deliverables] = levelCounts(m);
      return {
        maps: t.maps + 1,
        actors: t.actors + actors,
        impacts: t.impacts + impacts,
        deliverables: t.deliverables + deliverables,
      };
    },
    { maps: 0, actors: 0, impacts: 0, deliverables: 0 }
  );
  return {
    totals,
    examples: maps.length - own.length,
    maps: await Promise.all(
      maps.map(async (m) => {
        const root = m.nodes.find((n) => n.parentId === null);
        const [, actors, impacts, deliverables] = levelCounts(m);
        const focus = focusOf(m);
        return {
          id: m.id,
          title: m.title,
          example: isExampleId(m.id),
          goal: root ? { id: root.id, text: root.text, measure: root.measure ?? null } : null,
          targetDate: m.targetDate ?? null,
          productGoal: goalState(m, goals),
          counts: { actors, impacts, deliverables },
          focus: focus ? { id: focus.id, text: focus.text } : null,
          checks: mapChecks(m, hypotheses).map((c) => c.text),
          nodes: await Promise.all(
            m.nodes.map(async (n) => ({
              id: n.id,
              parentId: n.parentId,
              level: n.level,
              text: n.text,
              ...(n.detail ? { detail: n.detail } : {}),
              ...(n.measure ? { measure: n.measure } : {}),
              ...(n.personaId ? { personaId: n.personaId } : {}),
              ...(n.focus ? { focus: true } : {}),
              ...(n.sentTo?.length ? { sentTo: await linksOf(store, n.sentTo) } : {}),
            }))
          ),
          updatedAt: m.updatedAt,
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
    "Summarise the impact maps, newest first. Returns {totals: {maps, actors, impacts, deliverables} (examples left out), examples, maps: [{id, title, example, goal: {id, text, measure} (the root, level 0), targetDate, productGoal: {id, status} | {id, gone: true} | null, counts: {actors, impacts, deliverables}, focus: {id, text} | null, checks: string[] (what the map still misses), nodes: [{id, parentId, level (0 goal, 1 actor, 2 impact, 3 deliverable), text, detail?, measure?, personaId?, focus?, sentTo?: [{route, targetId, at, target: 'live' | 'done' | 'gone'}]}], updatedAt}]}. Strategy trees live in tool.strategy_tree.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStrategyStore),
  mcpHandler: async (_p, ctx) => listState(serverStrategyStore(ctx.userId)),
});

/* ── create_map ──────────────────────────────────────────────────────── */

const CreateSchema = z
  .object({
    goal: z
      .string()
      .max(NODE_TEXT_MAX)
      .optional()
      .describe("The goal: the change the business wants. Omit with fromProductGoal."),
    measure: z.string().max(NODE_TEXT_MAX).optional().describe("How the goal is measured."),
    targetDate: z.string().optional().describe("When the goal is due, YYYY-MM-DD."),
    fromProductGoal: z
      .boolean()
      .optional()
      .describe("Start from the active Product Goal: its statement, first measure and date."),
  })
  .refine((p) => Boolean(p.fromProductGoal) || Boolean(p.goal?.trim()), {
    message: "Give a goal, or fromProductGoal: true.",
  });

async function createMap(store: StrategyStore, p: z.infer<typeof CreateSchema>): Promise<Out> {
  if (
    p.targetDate !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(p.targetDate) || !isIsoDate(p.targetDate))
  ) {
    return { created: false, reason: "bad_date", message: "Give the date as YYYY-MM-DD." };
  }
  let goal = cleanText(p.goal, NODE_TEXT_MAX);
  let measure = cleanText(p.measure, NODE_TEXT_MAX);
  let targetDate = p.targetDate;
  let productGoalId: string | undefined;
  if (p.fromProductGoal) {
    const active = activeGoal(await store.goals());
    if (!active) {
      return {
        created: false,
        reason: "no_product_goal",
        message: "There is no active Product Goal. Give the goal instead.",
      };
    }
    goal ||= cleanText(active.statement, NODE_TEXT_MAX);
    measure ||= cleanText(active.measures[0], NODE_TEXT_MAX);
    targetDate ??= active.targetDate;
    productGoalId = active.id;
  }
  const map = newStrategyMap({
    id: `strategyMap_${nanoid(8)}`,
    rootId: nanoid(8),
    format: "impact-map",
    root: goal,
    ...(measure ? { measure } : {}),
    ...(productGoalId ? { productGoalId } : {}),
    ...(targetDate && isIsoDate(targetDate) ? { targetDate: targetDate.slice(0, 10) } : {}),
    now: new Date().toISOString(),
  });
  const saved = await saveMap(store, map, undefined);
  if (!saved.ok) return { created: false, reason: saved.reason, message: saved.message };
  return {
    created: true,
    id: map.id,
    goalId: map.nodes[0].id,
    productGoalId: productGoalId ?? null,
  };
}

// Additive → no confirm.
registry.register({
  id: `${TOOL}.create_map`,
  toolId: TOOL,
  name: "create_map",
  category: "write",
  requiresConfirmation: false,
  description:
    "Start an impact map from a goal (the change the business wants, with a measure and a date), or from the active Product Goal (fromProductGoal: true takes its statement, first measure and date, and links the map to it; a goal given still wins). Params: goal?, measure?, targetDate? (YYYY-MM-DD), fromProductGoal?. Returns {created: true, id, goalId (the root node, to add actors under), productGoalId} or {created: false, reason: 'no_product_goal' | 'bad_date' | 'rules' | 'too_big', message}.",
  paramsSchema: CreateSchema,
  handler: async (p) => createMap(browserStrategyStore, p),
  mcpHandler: async (p, ctx) => createMap(serverStrategyStore(ctx.userId), p),
});

/* ── add_node ────────────────────────────────────────────────────────── */

const AddSchema = z.object({
  mapId: z.string(),
  parentId: z
    .string()
    .describe(
      "The node it goes under: the goal for an actor, an actor for an impact, an impact for a deliverable."
    ),
  text: z.string().min(1).max(NODE_TEXT_MAX),
  detail: z.string().max(NODE_DETAIL_MAX).optional(),
  measure: z.string().max(NODE_TEXT_MAX).optional().describe("Only the goal has a measure."),
  personaId: z
    .string()
    .max(TOOL_TEXT_MAX.short)
    .optional()
    .describe("An actor's persona (a Persona Library id): actors only."),
});

const LEVEL_NAME = ["goal", "actor", "impact", "deliverable"] as const;

async function addNode(store: StrategyStore, p: z.infer<typeof AddSchema>): Promise<Out> {
  const map = (await store.maps()).find((m) => m.id === p.mapId && isImpactMap(m));
  if (!map) return { added: false, reason: "not_found" };
  const parent = map.nodes.find((n) => n.id === p.parentId);
  if (!parent) return { added: false, reason: "parent_not_found" };
  // "Clear example" removes the example maps: one added to them would go with them.
  if (isExampleId(map.id)) return { added: false, reason: "example" };
  if (parent.level >= 3) {
    return {
      added: false,
      reason: "leaf",
      message: "A deliverable holds nothing: add it under an impact instead.",
    };
  }
  if (map.nodes.length >= STRATEGY_NODES_MAX) {
    return {
      added: false,
      reason: "full",
      message: `A map holds at most ${STRATEGY_NODES_MAX} parts.`,
    };
  }
  const level = (parent.level + 1) as 1 | 2 | 3;
  const text = cleanText(p.text, NODE_TEXT_MAX);
  if (!text) return { added: false, reason: "blank" };
  if (p.personaId !== undefined) {
    if (level !== 1) {
      return { added: false, reason: "persona_level", message: "Only an actor links a persona." };
    }
    if (!(await store.personas()).some((x) => x.id === p.personaId)) {
      return { added: false, reason: "unknown_persona", message: "No persona has that id." };
    }
  }
  if (p.measure?.trim() && !levelHas("impact-map", level, "measure")) {
    return {
      added: false,
      reason: "measure_level",
      message: "Only the goal has a measure on an impact map.",
    };
  }
  const detail = cleanText(p.detail, NODE_DETAIL_MAX, false);
  const node: StrategyMapNode = {
    id: nanoid(8),
    parentId: parent.id,
    level,
    text,
    ...(detail ? { detail } : {}),
    ...(p.personaId ? { personaId: p.personaId } : {}),
  };
  const saved = await saveMap(store, withNode(map, node), map);
  if (!saved.ok) return { added: false, reason: saved.reason, message: saved.message };
  return { added: true, id: node.id, level, kind: LEVEL_NAME[level] };
}

registry.register({
  id: `${TOOL}.add_node`,
  toolId: TOOL,
  name: "add_node",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a part under another on an impact map; its level comes from the parent: under the goal an actor (who can help or block it; personaId links a Persona Library persona), under an actor an impact (how they must act differently: start, stop, more or less of something, never a feature), under an impact a deliverable (something to build or do). Text up to 200 characters, detail up to 1,000. Params: mapId, parentId, text, detail?, measure? (refused: only the goal has one), personaId?. Returns {added: true, id, level, kind} or {added: false, reason: 'not_found' | 'parent_not_found' | 'example' | 'leaf' (under a deliverable) | 'full' | 'blank' | 'persona_level' | 'unknown_persona' | 'measure_level' | 'rules' | 'too_big', message?}.",
  paramsSchema: AddSchema,
  handler: async (p) => addNode(browserStrategyStore, p),
  mcpHandler: async (p, ctx) => addNode(serverStrategyStore(ctx.userId), p),
});

/* ── set_focus ───────────────────────────────────────────────────────── */

const FocusSchema = z.object({
  mapId: z.string(),
  impactId: z.string().nullable().describe("The impact to work on first; null clears the focus."),
});

async function setFocus(store: StrategyStore, p: z.infer<typeof FocusSchema>): Promise<Out> {
  const map = (await store.maps()).find((m) => m.id === p.mapId && isImpactMap(m));
  if (!map) return { updated: false, reason: "not_found" };
  if (isExampleId(map.id)) return { updated: false, reason: "example" };
  const before = focusOf(map);
  if (p.impactId !== null) {
    const node = map.nodes.find((n) => n.id === p.impactId);
    if (!node) return { updated: false, reason: "node_not_found" };
    if (node.level !== 2) return { updated: false, reason: "not_impact" };
  }
  if ((before?.id ?? null) === p.impactId) return { updated: false, reason: "unchanged" };
  const saved = await saveMap(store, withFocus(map, p.impactId), map);
  if (!saved.ok) return { updated: false, reason: saved.reason, message: saved.message };
  return { updated: true, focus: p.impactId, previous: before?.id ?? null };
}

registry.register({
  id: `${TOOL}.set_focus`,
  toolId: TOOL,
  name: "set_focus",
  category: "write",
  requiresConfirmation: false,
  description:
    "Pick the impact the team works on first (one per map: picking one clears the other), or clear it (impactId: null). Params: mapId, impactId. Returns {updated: true, focus, previous} or {updated: false, reason: 'not_found' | 'example' | 'node_not_found' | 'not_impact' | 'unchanged' | 'rules' | 'too_big'}.",
  paramsSchema: FocusSchema,
  handler: async (p) => setFocus(browserStrategyStore, p),
  mcpHandler: async (p, ctx) => setFocus(serverStrategyStore(ctx.userId), p),
});

/* ── send_deliverable, test_impact ───────────────────────────────────── */

const SendSchema = z.object({
  mapId: z.string(),
  nodeId: z.string().describe("A deliverable (level 3)."),
  to: z.enum(["backlog-story", "epic"]).describe("A backlog story, or an epic on the roadmap."),
});

registry.register({
  id: `${TOOL}.send_deliverable`,
  toolId: TOOL,
  name: "send_deliverable",
  category: "write",
  requiresConfirmation: false,
  description:
    "Put a deliverable on the backlog as a story (to: 'backlog-story') or on the Epic Roadmap as an epic next quarter (to: 'epic'), as the page's Send to… does: it links back to the map ('From impact map') and its description names the actor, the impact and the goal. Once per route while that item exists (one deleted there can be sent again); never an example. Params: mapId, nodeId, to. Returns {sent: true, route, targetId, title} or {sent: false, reason: 'not_found' | 'example' | 'level' (not a deliverable) | 'already_sent' (with targetId) | 'blank' | 'too_big', message?}.",
  paramsSchema: SendSchema,
  handler: async (p) =>
    sendNode(browserStrategyStore, { mapId: p.mapId, nodeId: p.nodeId, route: p.to }, isImpactMap),
  mcpHandler: async (p, ctx) =>
    sendNode(
      serverStrategyStore(ctx.userId),
      { mapId: p.mapId, nodeId: p.nodeId, route: p.to },
      isImpactMap
    ),
});

const TestSchema = z.object({
  mapId: z.string(),
  nodeId: z.string().describe("An impact (level 2)."),
});

registry.register({
  id: `${TOOL}.test_impact`,
  toolId: TOOL,
  name: "test_impact",
  category: "write",
  requiresConfirmation: false,
  description:
    "Test an impact as a drafted hypothesis in the Hypothesis Tracker, as the page's 'Test this impact' does: we believe its deliverables will lead the actor to change (or that the actor will), to learn whether they really do, with the goal's measure as the success metric; linked both ways. Once while that hypothesis exists; never an example. Params: mapId, nodeId. Returns {sent: true, route: 'hypothesis', targetId, title} or {sent: false, reason: 'not_found' | 'example' | 'level' (not an impact) | 'already_sent' (with targetId) | 'blank' | 'too_big', message?}.",
  paramsSchema: TestSchema,
  handler: async (p) =>
    sendNode(
      browserStrategyStore,
      { mapId: p.mapId, nodeId: p.nodeId, route: "hypothesis" },
      isImpactMap
    ),
  mcpHandler: async (p, ctx) =>
    sendNode(
      serverStrategyStore(ctx.userId),
      { mapId: p.mapId, nodeId: p.nodeId, route: "hypothesis" },
      isImpactMap
    ),
});
