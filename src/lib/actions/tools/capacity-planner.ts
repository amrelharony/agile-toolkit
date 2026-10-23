/**
 * Capacity Planner — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1)
 * Agent surface: tool.capacity_planner.*
 * Backing CRUD : workspace.capacity_plan.* (auto-generated). One plan per
 *                sprint (`capacity-planner:sprint:<sprintId>`), with the
 *                `capacity-planner:current` plan as the fallback for a sprint
 *                that has none — the same lookup the page and Sprint Planning
 *                use (lib/sprints/capacity: findCapacityPlan).
 *
 *   1. list_state  — the sprint's plan (or the fallback), its effective hours
 *                    per member and in total, its share of a normal sprint,
 *                    and the points that suggests at the team's velocity.
 *   2. add_member  — add a team member to a sprint's plan (or the general one).
 *   3. set_config  — patch a plan's config (sprintDays, focusFactor, …).
 *
 * The hours come from lib/sprints/capacity (planCapacity), so an agent's
 * numbers match the page to the tenth of an hour.
 *
 * Entity kind "workspace:capacityPlan" (camelCase via kindFromToolId) matches
 * the browser sync engine so writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type {
  CapacityPlan,
  CapacityMember,
  CapacityConfig,
  Sprint,
} from "@/lib/stores/workspace-types";
import {
  CAPACITY_PLAN_ID,
  capacityPlanIdFor,
  findCapacityPlan,
  normalHours,
  planCapacity,
  pointsForecast,
} from "@/lib/sprints/capacity";
import { velocity } from "@/lib/sprints/metrics";

const KIND_CP = "workspace:capacityPlan";
const KIND_SPRINT = "workspace:sprint";

const ws = () => useWorkspaceStore.getState();

const DEFAULT_CONFIG: CapacityConfig = {
  sprintDays: 10,
  ceremonyOverhead: 15,
  focusFactor: 0.8,
  hoursPerDay: 8,
  pointsCommitted: "",
};

/** A new, empty plan for `sprintId` (or the general plan). */
function emptyPlan(sprintId?: string): CapacityPlan {
  return {
    id: capacityPlanIdFor(sprintId),
    members: [],
    config: { ...DEFAULT_CONFIG },
    ...(sprintId ? { sprintId } : {}),
  };
}

const SprintIdParam = z
  .string()
  .min(1)
  .optional()
  .describe(
    "The sprint whose plan to use. Omit for the general plan (capacity-planner:current), which also stands in for any sprint without its own."
  );

function summarize(
  found: { plan: CapacityPlan; perSprint: boolean } | undefined,
  sprints: readonly Sprint[],
  sprintId: string | undefined
) {
  if (!found) {
    return {
      exists: false,
      sprintId: sprintId ?? null,
      perSprint: false,
      memberCount: 0,
      totalEffectiveHours: 0,
      normalHours: 0,
      capacityRatio: null,
      suggestedPoints: null,
      config: null,
      perMember: [],
    };
  }
  const { plan, perSprint } = found;
  const summary = planCapacity(plan);
  const forecast = pointsForecast(
    plan,
    velocity(sprints.filter((s) => s.status === "completed")).average
  );
  return {
    exists: true,
    planId: plan.id,
    sprintId: sprintId ?? null,
    perSprint,
    memberCount: plan.members.length,
    totalEffectiveHours: summary.totalHours,
    normalHours: normalHours(plan),
    capacityRatio: forecast.ratio,
    suggestedPoints: forecast.points,
    config: plan.config,
    perMember: plan.members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      effectiveHours: summary.perMember.find((p) => p.id === m.id)?.effectiveHours ?? 0,
    })),
  };
}

// ──────── tool.capacity_planner.list_state ────────
registry.register({
  id: "tool.capacity_planner.list_state",
  toolId: "tool.capacity_planner",
  name: "list_state",
  category: "read",
  description:
    "Read a sprint's capacity plan (its own, else the general plan) with computed effective hours. Returns {exists, planId, sprintId, perSprint (false when the general plan stands in), memberCount, totalEffectiveHours, normalHours (everyone fully available), capacityRatio (this sprint's share of a normal one), suggestedPoints (recent velocity × that share), config, perMember: {id, name, role, effectiveHours}[]}.",
  paramsSchema: z.object({ sprintId: SprintIdParam }),
  handler: async ({ sprintId }) =>
    summarize(findCapacityPlan(ws().capacityPlans, sprintId), ws().sprints ?? [], sprintId),
  mcpHandler: async ({ sprintId }, ctx) => {
    const ids = sprintId ? [capacityPlanIdFor(sprintId), CAPACITY_PLAN_ID] : [CAPACITY_PLAN_ID];
    const plans = (
      await Promise.all(ids.map((id) => serverGetEntity<CapacityPlan>(ctx.userId, KIND_CP, id)))
    ).filter((p): p is CapacityPlan => Boolean(p));
    const sprints = await serverListEntities<Sprint>(ctx.userId, KIND_SPRINT);
    return summarize(findCapacityPlan(plans, sprintId), sprints, sprintId);
  },
});

function newMember(params: {
  name: string;
  role?: string;
  availability?: number;
  daysOff?: number;
}): CapacityMember {
  return {
    id: crypto.randomUUID(),
    name: params.name,
    role: params.role ?? "",
    availability: params.availability ?? 100,
    daysOff: params.daysOff ?? 0,
  };
}

// ──────── tool.capacity_planner.add_member ────────
registry.register({
  id: "tool.capacity_planner.add_member",
  toolId: "tool.capacity_planner",
  name: "add_member",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a team member to a sprint's capacity plan, or to the general plan without sprintId (availability 0–100, defaults 100; daysOff defaults 0). Creates that plan if absent. Returns {added: true, id, planId}.",
  paramsSchema: z.object({
    name: z.string().min(1),
    role: z.string().optional(),
    availability: z.number().min(0).max(100).optional(),
    daysOff: z.number().min(0).optional(),
    sprintId: SprintIdParam,
  }),
  handler: async ({ sprintId, ...params }) => {
    const id = capacityPlanIdFor(sprintId);
    const plan = (ws().capacityPlans ?? []).find((p) => p.id === id) ?? emptyPlan(sprintId);
    const member = newMember(params);
    ws().upsertCapacityPlan({ ...plan, members: [...plan.members, member] });
    return { added: true, id: member.id, planId: id };
  },
  mcpHandler: async ({ sprintId, ...params }, ctx) => {
    const id = capacityPlanIdFor(sprintId);
    const plan =
      (await serverGetEntity<CapacityPlan>(ctx.userId, KIND_CP, id)) ?? emptyPlan(sprintId);
    const member = newMember(params);
    await serverUpsertEntity<CapacityPlan>(ctx.userId, KIND_CP, {
      ...plan,
      members: [...plan.members, member],
    });
    return { added: true, id: member.id, planId: id };
  },
});

// ──────── tool.capacity_planner.set_config ────────
const ConfigPatch = z
  .object({
    sprintDays: z.number().min(0).optional(),
    ceremonyOverhead: z.number().min(0).max(100).optional(),
    focusFactor: z.number().min(0).max(1).optional(),
    hoursPerDay: z.number().min(0).optional(),
    pointsCommitted: z.string().optional(),
    sprintId: SprintIdParam,
  })
  .refine((p) => Object.entries(p).some(([key, v]) => key !== "sprintId" && v !== undefined), {
    message: "Provide at least one config field.",
  });

registry.register({
  id: "tool.capacity_planner.set_config",
  toolId: "tool.capacity_planner",
  name: "set_config",
  category: "write",
  requiresConfirmation: false,
  description:
    "Patch a capacity plan's config: sprintDays, ceremonyOverhead (0–100%), focusFactor (0–1, applied to the hours left after the Scrum events), hoursPerDay, pointsCommitted. Only the provided fields change. Targets the sprint's plan with sprintId, else the general plan; creates it if absent. Returns {updated: true, planId}.",
  paramsSchema: ConfigPatch,
  handler: async ({ sprintId, ...patch }) => {
    const id = capacityPlanIdFor(sprintId);
    const plan = (ws().capacityPlans ?? []).find((p) => p.id === id) ?? emptyPlan(sprintId);
    ws().upsertCapacityPlan({ ...plan, config: { ...plan.config, ...patch } });
    return { updated: true, planId: id };
  },
  mcpHandler: async ({ sprintId, ...patch }, ctx) => {
    const id = capacityPlanIdFor(sprintId);
    const plan =
      (await serverGetEntity<CapacityPlan>(ctx.userId, KIND_CP, id)) ?? emptyPlan(sprintId);
    await serverUpsertEntity<CapacityPlan>(ctx.userId, KIND_CP, {
      ...plan,
      config: { ...plan.config, ...patch },
    });
    return { updated: true, planId: id };
  },
});
