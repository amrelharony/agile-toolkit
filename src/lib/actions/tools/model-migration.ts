/**
 * Model Upgrade Migration Tracker — tool-local actions.
 *
 * Category: AI / LLM Product Management (squad S12b)
 * Tool:     Checklist + parity log for moving between LLM versions — from/to
 *           model, eval delta, cost delta, and a step checklist.
 *
 * Agent surface: tool.model_migration.*
 * Backing CRUD : workspace.model_migration.* (auto-generated). Singleton:
 *                one migration document under a fixed id.
 *
 *   1. list_state   — overview fields + step completion.
 *   2. set_details  — merge from/to model + eval/cost deltas.
 *   3. add_step     — append a checklist step.
 *   4. toggle_step  — flip (or set) a step's done flag by id.
 *
 * Entity kind "workspace:modelMigration" (kindFromToolId of
 * "workspace.model_migration") + the fixed MIGRATION_ID match the client.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { ModelMigration } from "@/lib/stores/workspace-types";

const KIND_MIGRATION = "workspace:modelMigration";
// MUST match MIGRATION_ID in model-migration-client.tsx.
const MIGRATION_ID = "modelMigration:current";

const ws = () => useWorkspaceStore.getState();

function emptyMigration(): ModelMigration {
  return {
    id: MIGRATION_ID,
    fromModel: "",
    toModel: "",
    evalDeltaPct: "",
    costDeltaPct: "",
    steps: [],
  };
}

function browserMigration(): ModelMigration | null {
  return (ws().modelMigrations ?? []).find((m) => m.id === MIGRATION_ID) ?? null;
}

function summarize(m: ModelMigration | null) {
  const steps = m?.steps ?? [];
  const doneSteps = steps.filter((s) => s.done).length;
  return {
    exists: m !== null,
    fromModel: m?.fromModel ?? "",
    toModel: m?.toModel ?? "",
    evalDeltaPct: m?.evalDeltaPct ?? "",
    costDeltaPct: m?.costDeltaPct ?? "",
    totalSteps: steps.length,
    doneSteps,
    completeness: steps.length ? Math.round((doneSteps / steps.length) * 100) / 100 : 0,
    steps,
  };
}

// ──────── tool.model_migration.list_state ────────
registry.register({
  id: "tool.model_migration.list_state",
  toolId: "tool.model_migration",
  name: "list_state",
  category: "read",
  description:
    "Read the model migration. Returns {exists, fromModel, toModel, evalDeltaPct, costDeltaPct, totalSteps, doneSteps, completeness (0..1), steps: {id, text, done}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserMigration()),
  mcpHandler: async (_params, ctx) => {
    const m = await serverGetEntity<ModelMigration>(ctx.userId, KIND_MIGRATION, MIGRATION_ID);
    return summarize(m ?? null);
  },
});

// ──────── tool.model_migration.set_details ────────
registry.register({
  id: "tool.model_migration.set_details",
  toolId: "tool.model_migration",
  name: "set_details",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set migration overview fields (merge — omitted fields untouched). Deltas are free-text and carry a sign, e.g. '+2.1' / '-18'. Creates the migration if absent. Returns {updated: true}.",
  paramsSchema: z.object({
    fromModel: z.string().max(200).optional(),
    toModel: z.string().max(200).optional(),
    evalDeltaPct: z.string().max(50).optional(),
    costDeltaPct: z.string().max(50).optional(),
  }),
  handler: async (params) => {
    const base = browserMigration() ?? emptyMigration();
    ws().upsertModelMigration({ ...base, ...params, id: MIGRATION_ID });
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<ModelMigration>(ctx.userId, KIND_MIGRATION, MIGRATION_ID)) ??
      emptyMigration();
    await serverUpsertEntity<ModelMigration>(ctx.userId, KIND_MIGRATION, {
      ...base,
      ...params,
      id: MIGRATION_ID,
    });
    return { updated: true };
  },
});

// ──────── tool.model_migration.add_step ────────
registry.register({
  id: "tool.model_migration.add_step",
  toolId: "tool.model_migration",
  name: "add_step",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append a checklist step (done: false). Creates the migration if absent. Returns {added: true, id}.",
  paramsSchema: z.object({ text: z.string().min(1).max(500) }),
  handler: async (params) => {
    const base = browserMigration() ?? emptyMigration();
    const stepId = crypto.randomUUID();
    ws().upsertModelMigration({
      ...base,
      id: MIGRATION_ID,
      steps: [...base.steps, { id: stepId, text: params.text, done: false }],
    });
    return { added: true, id: stepId };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<ModelMigration>(ctx.userId, KIND_MIGRATION, MIGRATION_ID)) ??
      emptyMigration();
    const stepId = crypto.randomUUID();
    await serverUpsertEntity<ModelMigration>(ctx.userId, KIND_MIGRATION, {
      ...base,
      id: MIGRATION_ID,
      steps: [...base.steps, { id: stepId, text: params.text, done: false }],
    });
    return { added: true, id: stepId };
  },
});

// ──────── tool.model_migration.toggle_step ────────
// `done` optional — omit to flip, or pass an explicit value to set it. The
// migration/step must already exist (no auto-create on a toggle).
registry.register({
  id: "tool.model_migration.toggle_step",
  toolId: "tool.model_migration",
  name: "toggle_step",
  category: "write",
  requiresConfirmation: false,
  description:
    "Toggle a step's done flag by id, or set it explicitly via `done`. Returns {updated: false} when the migration or step id is unknown.",
  paramsSchema: z.object({
    stepId: z.string(),
    done: z.boolean().optional().describe("Omit to flip the current value."),
  }),
  handler: async (params) => {
    const base = browserMigration();
    const next = toggle(base, params.stepId, params.done);
    if (!next) return { updated: false };
    ws().upsertModelMigration(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<ModelMigration>(ctx.userId, KIND_MIGRATION, MIGRATION_ID);
    const next = toggle(base ?? null, params.stepId, params.done);
    if (!next) return { updated: false };
    await serverUpsertEntity<ModelMigration>(ctx.userId, KIND_MIGRATION, next);
    return { updated: true };
  },
});

/** Return a new migration with the step's done flag flipped (or set), or null
 *  when the migration / step id is unknown. */
function toggle(
  m: ModelMigration | null,
  stepId: string,
  done: boolean | undefined
): ModelMigration | null {
  if (!m || !m.steps.some((s) => s.id === stepId)) return null;
  return {
    ...m,
    steps: m.steps.map((s) => (s.id === stepId ? { ...s, done: done ?? !s.done } : s)),
  };
}
