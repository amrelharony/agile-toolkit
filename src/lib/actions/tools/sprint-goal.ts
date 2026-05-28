/**
 * Sprint Goal — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1)
 * Agent surface: tool.sprint_goal.*
 * Backing CRUD : workspace.sprint_goal.* (auto-generated). Singleton: one
 *                SprintGoal document under a fixed id.
 *
 *   1. list_state    — objective, goal statement, acceptance-criteria count,
 *                      and key results in one read.
 *   2. set_goal      — set the business objective and/or goal statement
 *                      (creates the singleton if absent).
 *   3. add_criterion — append an acceptance criterion.
 *
 * Entity kind "workspace:sprintGoal" (camelCase via kindFromToolId) matches
 * the browser sync engine so writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { SprintGoal } from "@/lib/stores/workspace-types";

const KIND_SG = "workspace:sprintGoal";
// MUST match SG_ID in sprint-goal-client.tsx.
const SG_ID = "sprint-goal:current";

const ws = () => useWorkspaceStore.getState();

function browserDoc(): SprintGoal | null {
  return (ws().sprintGoals ?? []).find((g) => g.id === SG_ID) ?? null;
}

function emptyGoal(): SprintGoal {
  return { id: SG_ID, businessObjective: "", goal: "", criteria: [], keyResults: [] };
}

function summarize(g: SprintGoal | null) {
  if (!g) {
    return {
      exists: false,
      businessObjective: "",
      goal: "",
      criteriaCount: 0,
      relevantCount: 0,
      keyResults: [] as string[],
      criteria: [] as SprintGoal["criteria"],
    };
  }
  return {
    exists: true,
    businessObjective: g.businessObjective,
    goal: g.goal,
    criteriaCount: g.criteria.length,
    relevantCount: g.criteria.filter((c) => c.relevantChecked).length,
    keyResults: g.keyResults,
    criteria: g.criteria,
  };
}

// ──────── tool.sprint_goal.list_state ────────
registry.register({
  id: "tool.sprint_goal.list_state",
  toolId: "tool.sprint_goal",
  name: "list_state",
  category: "read",
  description:
    "Read the current sprint goal. Returns {exists, businessObjective, goal, criteriaCount, relevantCount, keyResults, criteria}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const g = await serverGetEntity<SprintGoal>(ctx.userId, KIND_SG, SG_ID);
    return summarize(g ?? null);
  },
});

// ──────── tool.sprint_goal.set_goal ────────
registry.register({
  id: "tool.sprint_goal.set_goal",
  toolId: "tool.sprint_goal",
  name: "set_goal",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the sprint goal's business objective and/or goal statement (creates the singleton if absent). Returns {updated: true}.",
  paramsSchema: z
    .object({
      businessObjective: z.string().optional(),
      goal: z.string().optional(),
    })
    .refine((p) => p.businessObjective !== undefined || p.goal !== undefined, {
      message: "Provide businessObjective and/or goal.",
    }),
  handler: async (params) => {
    const next = { ...(browserDoc() ?? emptyGoal()) };
    if (params.businessObjective !== undefined) next.businessObjective = params.businessObjective;
    if (params.goal !== undefined) next.goal = params.goal;
    ws().upsertSprintGoal(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const next = {
      ...((await serverGetEntity<SprintGoal>(ctx.userId, KIND_SG, SG_ID)) ?? emptyGoal()),
    };
    if (params.businessObjective !== undefined) next.businessObjective = params.businessObjective;
    if (params.goal !== undefined) next.goal = params.goal;
    await serverUpsertEntity<SprintGoal>(ctx.userId, KIND_SG, next);
    return { updated: true };
  },
});

// ──────── tool.sprint_goal.add_criterion ────────
registry.register({
  id: "tool.sprint_goal.add_criterion",
  toolId: "tool.sprint_goal",
  name: "add_criterion",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append an acceptance criterion to the sprint goal (creates the singleton if absent). Returns {added: true, id}.",
  paramsSchema: z.object({ text: z.string().min(1) }),
  handler: async (params) => {
    const doc = browserDoc() ?? emptyGoal();
    const id = crypto.randomUUID();
    ws().upsertSprintGoal({
      ...doc,
      criteria: [...doc.criteria, { id, text: params.text, relevantChecked: false }],
    });
    return { added: true, id };
  },
  mcpHandler: async (params, ctx) => {
    const doc = (await serverGetEntity<SprintGoal>(ctx.userId, KIND_SG, SG_ID)) ?? emptyGoal();
    const id = crypto.randomUUID();
    await serverUpsertEntity<SprintGoal>(ctx.userId, KIND_SG, {
      ...doc,
      criteria: [...doc.criteria, { id, text: params.text, relevantChecked: false }],
    });
    return { added: true, id };
  },
});
