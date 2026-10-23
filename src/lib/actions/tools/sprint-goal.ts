/**
 * Sprint Goal — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1)
 * Agent surface: tool.sprint_goal.*
 * Backing CRUD : workspace.sprint_goal.* (auto-generated). One goal document
 *                per sprint (`sprint-goal:sprint:<sprintId>`), plus the
 *                `sprint-goal:current` draft for when no sprint is named —
 *                the same documents the page reads (lib/sprints/goal-doc).
 *
 *   1. list_state     — objective, goal statement, criteria, linked OKRs,
 *                       key-result notes and the outcome, in one read. A
 *                       sprint with no document yet reads its Sprint.goal,
 *                       as the page does.
 *   2. set_goal       — set the objective and/or goal statement; for a
 *                       sprint, the statement is mirrored to Sprint.goal.
 *   3. add_criterion  — append an acceptance criterion.
 *   4. link_okr / unlink_okr — link or unlink a workspace OKR.
 *   5. record_outcome — "Did we meet the goal?": met | partly | not-met,
 *                       with a note (Sprint Review reads it).
 *
 * Entity kind "workspace:sprintGoal" (camelCase via kindFromToolId) matches
 * the browser sync engine so writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { Sprint, SprintGoal } from "@/lib/stores/workspace-types";
import { GOAL_OUTCOMES, blankGoal, goalDocId } from "@/lib/sprints/goal-doc";

const KIND_SG = "workspace:sprintGoal";
const KIND_SPRINT = "workspace:sprint";

const ws = () => useWorkspaceStore.getState();

const SprintIdParam = z
  .string()
  .min(1)
  .optional()
  .describe("The sprint whose goal to use. Omit for the draft (sprint-goal:current).");

/** Where reads and writes go, in the browser or on the server. */
interface GoalStore {
  getGoal: (id: string) => Promise<SprintGoal | null>;
  putGoal: (doc: SprintGoal) => Promise<void>;
  getSprint: (id: string) => Promise<Sprint | null>;
  putSprint: (sprint: Sprint) => Promise<void>;
}

const browserStore: GoalStore = {
  getGoal: async (id) => (ws().sprintGoals ?? []).find((g) => g.id === id) ?? null,
  putGoal: async (doc) => ws().upsertSprintGoal(doc),
  getSprint: async (id) => (ws().sprints ?? []).find((s) => s.id === id) ?? null,
  putSprint: async (sprint) => ws().upsertSprint(sprint),
};

const serverStore = (userId: string): GoalStore => ({
  getGoal: (id) => serverGetEntity<SprintGoal>(userId, KIND_SG, id),
  putGoal: async (doc) => {
    await serverUpsertEntity<SprintGoal>(userId, KIND_SG, doc);
  },
  getSprint: (id) => serverGetEntity<Sprint>(userId, KIND_SPRINT, id),
  putSprint: async (sprint) => {
    await serverUpsertEntity<Sprint>(userId, KIND_SPRINT, sprint);
  },
});

/** The goal document for `sprintId` (or the draft), or a blank one ready to store. */
async function loadGoal(store: GoalStore, sprintId?: string) {
  const doc = await store.getGoal(goalDocId(sprintId));
  return { doc: doc ?? blankGoal(sprintId), exists: Boolean(doc) };
}

async function summarize(store: GoalStore, sprintId?: string) {
  const { doc, exists } = await loadGoal(store, sprintId);
  const sprint = sprintId ? await store.getSprint(sprintId) : null;
  // A sprint whose goal was set elsewhere (Sprint Planning, the cockpit)
  // reads that statement until its own document has one.
  const goal = doc.goal.trim() ? doc.goal : (sprint?.goal ?? "");
  const criteria = Array.isArray(doc.criteria) ? doc.criteria : [];
  return {
    exists,
    sprintId: sprintId ?? null,
    sprintGoal: sprint?.goal ?? null,
    businessObjective: doc.businessObjective ?? "",
    goal,
    criteriaCount: criteria.length,
    relevantCount: criteria.filter((c) => c.relevantChecked).length,
    criteria,
    okrIds: doc.okrIds ?? [],
    keyResults: doc.keyResults ?? [],
    outcome: doc.outcome ?? null,
  };
}

/** Store `next`, and mirror its statement to Sprint.goal when it changed. */
async function saveGoal(store: GoalStore, next: SprintGoal, sprintId?: string) {
  await store.putGoal(next);
  if (!sprintId) return;
  const sprint = await store.getSprint(sprintId);
  const statement = next.goal.trim();
  if (sprint && statement && sprint.goal !== statement) {
    await store.putSprint({ ...sprint, goal: statement });
  }
}

// ──────── tool.sprint_goal.list_state ────────
registry.register({
  id: "tool.sprint_goal.list_state",
  toolId: "tool.sprint_goal",
  name: "list_state",
  category: "read",
  description:
    "Read a sprint's goal (or the draft without sprintId). Returns {exists, sprintId, sprintGoal (Sprint.goal), businessObjective, goal, criteriaCount, relevantCount, criteria, okrIds, keyResults (legacy notes), outcome: {met: met|partly|not-met, note, decidedAt} | null}. A sprint without its own goal document reads Sprint.goal, as the page does.",
  paramsSchema: z.object({ sprintId: SprintIdParam }),
  handler: async ({ sprintId }) => summarize(browserStore, sprintId),
  mcpHandler: async ({ sprintId }, ctx) => summarize(serverStore(ctx.userId), sprintId),
});

// ──────── tool.sprint_goal.set_goal ────────
const SetGoalParams = z
  .object({
    businessObjective: z.string().optional(),
    goal: z.string().max(300).optional(),
    sprintId: SprintIdParam,
  })
  .refine((p) => p.businessObjective !== undefined || p.goal !== undefined, {
    message: "Provide businessObjective and/or goal.",
  });

async function setGoal(store: GoalStore, params: z.infer<typeof SetGoalParams>) {
  const { doc } = await loadGoal(store, params.sprintId);
  const next = { ...doc };
  if (params.businessObjective !== undefined) next.businessObjective = params.businessObjective;
  if (params.goal !== undefined) next.goal = params.goal;
  await saveGoal(store, next, params.sprintId);
  return { updated: true, id: next.id };
}

registry.register({
  id: "tool.sprint_goal.set_goal",
  toolId: "tool.sprint_goal",
  name: "set_goal",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a sprint goal's business objective and/or goal statement (max 300 characters), creating the document if absent. With sprintId the statement is also written to Sprint.goal, which Sprint Planning and the cockpit show. Returns {updated: true, id}.",
  paramsSchema: SetGoalParams,
  handler: async (params) => setGoal(browserStore, params),
  mcpHandler: async (params, ctx) => setGoal(serverStore(ctx.userId), params),
});

// ──────── tool.sprint_goal.add_criterion ────────
const CriterionParams = z.object({ text: z.string().min(1), sprintId: SprintIdParam });

async function addCriterion(store: GoalStore, params: z.infer<typeof CriterionParams>) {
  const { doc } = await loadGoal(store, params.sprintId);
  const id = crypto.randomUUID();
  await store.putGoal({
    ...doc,
    criteria: [...(doc.criteria ?? []), { id, text: params.text, relevantChecked: false }],
  });
  return { added: true, id };
}

registry.register({
  id: "tool.sprint_goal.add_criterion",
  toolId: "tool.sprint_goal",
  name: "add_criterion",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append an acceptance criterion to a sprint's goal (or the draft), creating the document if absent. Returns {added: true, id}.",
  paramsSchema: CriterionParams,
  handler: async (params) => addCriterion(browserStore, params),
  mcpHandler: async (params, ctx) => addCriterion(serverStore(ctx.userId), params),
});

// ──────── tool.sprint_goal.link_okr / unlink_okr ────────
const OkrParams = z.object({ okrId: z.string().min(1), sprintId: SprintIdParam });

async function linkOkr(store: GoalStore, params: z.infer<typeof OkrParams>, link: boolean) {
  const { doc } = await loadGoal(store, params.sprintId);
  const current = doc.okrIds ?? [];
  const has = current.includes(params.okrId);
  if (has === link) return { changed: false };
  const okrIds = link ? [...current, params.okrId] : current.filter((id) => id !== params.okrId);
  await store.putGoal({ ...doc, okrIds });
  return { changed: true };
}

registry.register({
  id: "tool.sprint_goal.link_okr",
  toolId: "tool.sprint_goal",
  name: "link_okr",
  category: "write",
  requiresConfirmation: false,
  description:
    "Link a workspace OKR (by id) to a sprint's goal, instead of copying key results into it. Returns {changed} (false when already linked).",
  paramsSchema: OkrParams,
  handler: async (params) => linkOkr(browserStore, params, true),
  mcpHandler: async (params, ctx) => linkOkr(serverStore(ctx.userId), params, true),
});

registry.register({
  id: "tool.sprint_goal.unlink_okr",
  toolId: "tool.sprint_goal",
  name: "unlink_okr",
  category: "write",
  requiresConfirmation: false,
  description:
    "Unlink an OKR from a sprint's goal. Returns {changed} (false when it wasn't linked).",
  paramsSchema: OkrParams,
  handler: async (params) => linkOkr(browserStore, params, false),
  mcpHandler: async (params, ctx) => linkOkr(serverStore(ctx.userId), params, false),
});

// ──────── tool.sprint_goal.record_outcome ────────
const OutcomeParams = z.object({
  sprintId: z.string().min(1).describe("The sprint whose goal this answers."),
  met: z.enum(GOAL_OUTCOMES as ["met", "partly", "not-met"]),
  note: z.string().max(2000).optional(),
});

async function recordOutcome(store: GoalStore, params: z.infer<typeof OutcomeParams>) {
  const { doc } = await loadGoal(store, params.sprintId);
  const note = params.note?.trim();
  await store.putGoal({
    ...doc,
    outcome: { met: params.met, ...(note ? { note } : {}), decidedAt: new Date().toISOString() },
  });
  return { recorded: true };
}

registry.register({
  id: "tool.sprint_goal.record_outcome",
  toolId: "tool.sprint_goal",
  name: "record_outcome",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record whether a sprint met its goal (met | partly | not-met) with an optional note; Sprint Review reads it. Replaces an earlier answer. Returns {recorded: true}.",
  paramsSchema: OutcomeParams,
  handler: async (params) => recordOutcome(browserStore, params),
  mcpHandler: async (params, ctx) => recordOutcome(serverStore(ctx.userId), params),
});
