/**
 * Capacity Planner — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1)
 * Agent surface: tool.capacity_planner.*
 * Backing CRUD : workspace.capacity_plan.* (auto-generated). Singleton: one
 *                CapacityPlan document (members + sprint config) under a
 *                fixed id.
 *
 *   1. list_state  — members, config, and the computed effective hours
 *                    (per member + team total), using the same formula the
 *                    in-app tool renders.
 *   2. add_member  — add a team member to the plan.
 *   3. set_config  — patch the sprint config (sprintDays, focusFactor, …).
 *
 * Entity kind "workspace:capacityPlan" (camelCase via kindFromToolId) matches
 * the browser sync engine so writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { CapacityPlan, CapacityMember, CapacityConfig } from "@/lib/stores/workspace-types";

const KIND_CP = "workspace:capacityPlan";
// MUST match CP_ID in capacity-planner-client.tsx.
const CP_ID = "capacity-planner:current";

const ws = () => useWorkspaceStore.getState();

function browserDoc(): CapacityPlan | null {
  return (ws().capacityPlans ?? []).find((p) => p.id === CP_ID) ?? null;
}

const DEFAULT_CONFIG: CapacityConfig = {
  sprintDays: 10,
  ceremonyOverhead: 15,
  focusFactor: 0.8,
  hoursPerDay: 8,
  pointsCommitted: "",
};

function emptyPlan(): CapacityPlan {
  return { id: CP_ID, members: [], config: { ...DEFAULT_CONFIG } };
}

/** Effective sprint hours for one member. Mirrors calcEffectiveHours in
 *  capacity-planner-client.tsx — keep in sync so the agent's numbers match
 *  the UI. */
function effectiveHours(m: CapacityMember, c: CapacityConfig): number {
  const workingDays = Math.max(c.sprintDays - m.daysOff, 0);
  return (
    workingDays *
    (m.availability / 100) *
    c.hoursPerDay *
    c.focusFactor *
    (1 - c.ceremonyOverhead / 100)
  );
}

function summarize(plan: CapacityPlan | null) {
  if (!plan) {
    return { exists: false, memberCount: 0, totalEffectiveHours: 0, config: null, perMember: [] };
  }
  const perMember = plan.members.map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role,
    effectiveHours: Math.round(effectiveHours(m, plan.config) * 10) / 10,
  }));
  return {
    exists: true,
    memberCount: plan.members.length,
    totalEffectiveHours: Math.round(perMember.reduce((a, m) => a + m.effectiveHours, 0) * 10) / 10,
    config: plan.config,
    perMember,
  };
}

// ──────── tool.capacity_planner.list_state ────────
registry.register({
  id: "tool.capacity_planner.list_state",
  toolId: "tool.capacity_planner",
  name: "list_state",
  category: "read",
  description:
    "Read the capacity plan with computed effective hours. Returns {exists, memberCount, totalEffectiveHours, config, perMember: {id, name, role, effectiveHours}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const plan = await serverGetEntity<CapacityPlan>(ctx.userId, KIND_CP, CP_ID);
    return summarize(plan ?? null);
  },
});

// ──────── tool.capacity_planner.add_member ────────
registry.register({
  id: "tool.capacity_planner.add_member",
  toolId: "tool.capacity_planner",
  name: "add_member",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a team member to the capacity plan (availability 0–100, defaults 100; daysOff defaults 0). Creates the plan if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    name: z.string().min(1),
    role: z.string().optional(),
    availability: z.number().min(0).max(100).optional(),
    daysOff: z.number().min(0).optional(),
  }),
  handler: async (params) => {
    const plan = browserDoc() ?? emptyPlan();
    const member: CapacityMember = {
      id: crypto.randomUUID(),
      name: params.name,
      role: params.role ?? "",
      availability: params.availability ?? 100,
      daysOff: params.daysOff ?? 0,
    };
    ws().upsertCapacityPlan({ ...plan, members: [...plan.members, member] });
    return { added: true, id: member.id };
  },
  mcpHandler: async (params, ctx) => {
    const plan = (await serverGetEntity<CapacityPlan>(ctx.userId, KIND_CP, CP_ID)) ?? emptyPlan();
    const member: CapacityMember = {
      id: crypto.randomUUID(),
      name: params.name,
      role: params.role ?? "",
      availability: params.availability ?? 100,
      daysOff: params.daysOff ?? 0,
    };
    await serverUpsertEntity<CapacityPlan>(ctx.userId, KIND_CP, {
      ...plan,
      members: [...plan.members, member],
    });
    return { added: true, id: member.id };
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
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: "Provide at least one config field.",
  });

registry.register({
  id: "tool.capacity_planner.set_config",
  toolId: "tool.capacity_planner",
  name: "set_config",
  category: "write",
  requiresConfirmation: false,
  description:
    "Patch the sprint config: sprintDays, ceremonyOverhead (0–100%), focusFactor (0–1), hoursPerDay, pointsCommitted. Only the provided fields change. Creates the plan if absent. Returns {updated: true}.",
  paramsSchema: ConfigPatch,
  handler: async (params) => {
    const plan = browserDoc() ?? emptyPlan();
    ws().upsertCapacityPlan({ ...plan, config: { ...plan.config, ...params } });
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const plan = (await serverGetEntity<CapacityPlan>(ctx.userId, KIND_CP, CP_ID)) ?? emptyPlan();
    await serverUpsertEntity<CapacityPlan>(ctx.userId, KIND_CP, {
      ...plan,
      config: { ...plan.config, ...params },
    });
    return { updated: true };
  },
});
