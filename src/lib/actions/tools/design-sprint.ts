/**
 * Design Sprint Tracker — tool-local actions.
 *
 * Category: Workshops & Facilitation (squad S11)
 * Tool:     5-day GV design-sprint timeline (Map / Sketch / Decide /
 *           Prototype / Test) with daily tasks.
 *
 * Agent surface: tool.design_sprint.*
 * Backing CRUD : workspace.design_sprint.* (auto-generated). Singleton: one
 *                DesignSprint document (a nullable sprint) under a fixed id.
 *
 *   1. list_state    — sprint overview + per-day task completion (or null).
 *   2. start_sprint  — create the 5-day skeleton.
 *   3. add_task      — add a task to a given day (1..5).
 *   4. toggle_task   — flip a task's done flag.
 *
 * Entity kind "workspace:designSprint" + the fixed DS_ID match
 * design-sprint-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type {
  DesignSprint,
  DesignSprintPlan,
  DesignSprintDayNumber,
} from "@/lib/stores/workspace-types";

const KIND_DS = "workspace:designSprint";
// MUST match DS_ID in design-sprint-client.tsx.
const DS_ID = "designSprint:current";

/** The fixed GV design-sprint day names, in order. */
const DAY_NAMES = ["Map", "Sketch", "Decide", "Prototype", "Test"] as const;

const ws = () => useWorkspaceStore.getState();

function emptyDoc(): DesignSprint {
  return { id: DS_ID, sprint: null };
}

function browserDoc(): DesignSprint | null {
  return (ws().designSprints ?? []).find((d) => d.id === DS_ID) ?? null;
}

function newPlan(name: string, startDate: string): DesignSprintPlan {
  return {
    id: crypto.randomUUID(),
    name,
    startDate,
    currentDay: 1,
    days: DAY_NAMES.map((dayName, i) => ({
      day: (i + 1) as DesignSprintDayNumber,
      dayName,
      tasks: [],
      artifacts: [],
    })),
  };
}

function summarize(doc: DesignSprint | null) {
  const sprint = doc?.sprint ?? null;
  if (!sprint) return { exists: doc !== null, sprint: null };
  let totalTasks = 0;
  let doneTasks = 0;
  const days = sprint.days.map((d) => {
    totalTasks += d.tasks.length;
    const doneCount = d.tasks.filter((t) => t.done).length;
    doneTasks += doneCount;
    return { day: d.day, dayName: d.dayName, taskCount: d.tasks.length, doneCount };
  });
  return {
    exists: true,
    sprint: {
      name: sprint.name,
      startDate: sprint.startDate,
      currentDay: sprint.currentDay,
      totalTasks,
      doneTasks,
      completedAt: sprint.completedAt,
      days,
    },
  };
}

// ──────── tool.design_sprint.list_state ────────
registry.register({
  id: "tool.design_sprint.list_state",
  toolId: "tool.design_sprint",
  name: "list_state",
  category: "read",
  description:
    "Summarise the design sprint. Returns {exists, sprint: {name, startDate, currentDay, totalTasks, doneTasks, completedAt, days: {day, dayName, taskCount, doneCount}[]} | null}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<DesignSprint>(ctx.userId, KIND_DS, DS_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.design_sprint.start_sprint ────────
registry.register({
  id: "tool.design_sprint.start_sprint",
  toolId: "tool.design_sprint",
  name: "start_sprint",
  category: "write",
  requiresConfirmation: false,
  description:
    "Create a design sprint with the 5-day skeleton (Map, Sketch, Decide, Prototype, Test), currentDay 1, empty tasks. startDate defaults to today. Replaces any existing sprint. Returns {started: true, id}.",
  paramsSchema: z.object({
    name: z.string().min(1).max(200),
    startDate: z.string().optional().describe("YYYY-MM-DD; defaults to today."),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const plan = newPlan(params.name, params.startDate ?? today());
    ws().upsertDesignSprint({ ...base, id: DS_ID, sprint: plan });
    return { started: true, id: plan.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<DesignSprint>(ctx.userId, KIND_DS, DS_ID)) ?? emptyDoc();
    const plan = newPlan(params.name, params.startDate ?? today());
    await serverUpsertEntity<DesignSprint>(ctx.userId, KIND_DS, {
      ...base,
      id: DS_ID,
      sprint: plan,
    });
    return { started: true, id: plan.id };
  },
});

// ──────── tool.design_sprint.add_task ────────
registry.register({
  id: "tool.design_sprint.add_task",
  toolId: "tool.design_sprint",
  name: "add_task",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a task to a sprint day (day 1..5). Returns {added: false} when no sprint exists or the day is out of range, else {added: true, id}.",
  paramsSchema: z.object({
    day: z.number().int().min(1).max(5),
    text: z.string().min(1).max(500),
    owner: z.string().max(200).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc();
    const r = addTask(base, params);
    if (!r) return { added: false };
    ws().upsertDesignSprint(r.next);
    return { added: true, id: r.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<DesignSprint>(ctx.userId, KIND_DS, DS_ID);
    const r = addTask(base ?? null, params);
    if (!r) return { added: false };
    await serverUpsertEntity<DesignSprint>(ctx.userId, KIND_DS, r.next);
    return { added: true, id: r.id };
  },
});

// ──────── tool.design_sprint.toggle_task ────────
registry.register({
  id: "tool.design_sprint.toggle_task",
  toolId: "tool.design_sprint",
  name: "toggle_task",
  category: "write",
  requiresConfirmation: false,
  description:
    "Toggle a task's done flag by id (or set it via `done`). Returns {updated: false} when no sprint exists or the task id is unknown.",
  paramsSchema: z.object({
    taskId: z.string(),
    done: z.boolean().optional().describe("Omit to flip the current value."),
  }),
  handler: async (params) => {
    const next = toggleTask(browserDoc(), params.taskId, params.done);
    if (!next) return { updated: false };
    ws().upsertDesignSprint(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<DesignSprint>(ctx.userId, KIND_DS, DS_ID);
    const next = toggleTask(base ?? null, params.taskId, params.done);
    if (!next) return { updated: false };
    await serverUpsertEntity<DesignSprint>(ctx.userId, KIND_DS, next);
    return { updated: true };
  },
});

const today = () => new Date().toISOString().slice(0, 10);

/** Append a task to the matching day; null when no sprint / day not found. */
function addTask(
  doc: DesignSprint | null,
  params: { day: number; text: string; owner?: string }
): { next: DesignSprint; id: string } | null {
  if (!doc?.sprint) return null;
  if (!doc.sprint.days.some((d) => d.day === params.day)) return null;
  const id = crypto.randomUUID();
  const next: DesignSprint = {
    ...doc,
    id: DS_ID,
    sprint: {
      ...doc.sprint,
      days: doc.sprint.days.map((d) =>
        d.day === params.day
          ? {
              ...d,
              tasks: [...d.tasks, { id, text: params.text, done: false, owner: params.owner }],
            }
          : d
      ),
    },
  };
  return { next, id };
}

/** Flip (or set) a task's done flag; null when no sprint / task not found. */
function toggleTask(
  doc: DesignSprint | null,
  taskId: string,
  done: boolean | undefined
): DesignSprint | null {
  if (!doc?.sprint) return null;
  if (!doc.sprint.days.some((d) => d.tasks.some((t) => t.id === taskId))) return null;
  return {
    ...doc,
    id: DS_ID,
    sprint: {
      ...doc.sprint,
      days: doc.sprint.days.map((d) => ({
        ...d,
        tasks: d.tasks.map((t) => (t.id === taskId ? { ...t, done: done ?? !t.done } : t)),
      })),
    },
  };
}
