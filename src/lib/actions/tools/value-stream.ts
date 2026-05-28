/**
 * Value Stream Map — tool-local actions.
 *
 * Category: Flow & Delivery (squad S6)
 * Agent surface: tool.value_stream.*
 * Backing CRUD : workspace.value_stream_stage.* (auto-generated).
 *
 *   1. list_state — total process/lead time, flow efficiency
 *      (process ÷ lead), and rolled %C/A (product of per-stage complete-
 *      and-accurate rates) — the headline value-stream metrics.
 *   2. add_stage  — append a stage to the value stream.
 *
 * Entity kind "workspace:valueStreamStage" (camelCase via kindFromToolId)
 * matches the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import type { ValueStreamStage } from "@/lib/stores/workspace-types";

const KIND_VS = "workspace:valueStreamStage";

const ws = () => useWorkspaceStore.getState();

const round1 = (n: number) => Math.round(n * 10) / 10;

function summarize(stages: ValueStreamStage[]) {
  const totalProcessTime = stages.reduce((a, s) => a + (s.processTime || 0), 0);
  const totalLeadTime = stages.reduce((a, s) => a + (s.leadTime || 0), 0);
  // Rolled %C/A: the fraction of work passing all stages without rework —
  // the product of each stage's complete-and-accurate rate.
  const rolled =
    stages.length > 0
      ? stages.reduce((a, s) => a * Math.max(0, Math.min(1, (s.completeAccurate || 0) / 100)), 1)
      : 0;
  return {
    stageCount: stages.length,
    totalProcessTime: round1(totalProcessTime),
    totalLeadTime: round1(totalLeadTime),
    // Flow efficiency: value-add (process) time as a % of total lead time.
    flowEfficiencyPct: totalLeadTime > 0 ? Math.round((totalProcessTime / totalLeadTime) * 100) : 0,
    rolledCompleteAccuratePct: Math.round(rolled * 100),
  };
}

// ──────── tool.value_stream.list_state ────────
registry.register({
  id: "tool.value_stream.list_state",
  toolId: "tool.value_stream",
  name: "list_state",
  category: "read",
  description:
    "Summarise the value stream. Returns {stageCount, totalProcessTime, totalLeadTime, flowEfficiencyPct (process ÷ lead), rolledCompleteAccuratePct (product of per-stage %C/A)}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(ws().valueStreamStages ?? []),
  mcpHandler: async (_params, ctx) => {
    const stages = await serverListEntities<ValueStreamStage>(ctx.userId, KIND_VS);
    return summarize(stages);
  },
});

// ──────── tool.value_stream.add_stage ────────
registry.register({
  id: "tool.value_stream.add_stage",
  toolId: "tool.value_stream",
  name: "add_stage",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append a stage to the value stream. processTime + leadTime in a consistent unit (e.g. days); completeAccurate is the %C/A (0–100). Returns {added: true, id}.",
  paramsSchema: z.object({
    name: z.string().min(1),
    processTime: z.number().min(0),
    leadTime: z.number().min(0),
    completeAccurate: z.number().min(0).max(100),
    description: z.string().optional(),
  }),
  handler: async (params) => {
    const stage: ValueStreamStage = { id: crypto.randomUUID(), ...params };
    ws().upsertValueStreamStage(stage);
    return { added: true, id: stage.id };
  },
  mcpHandler: async (params, ctx) => {
    const stage: ValueStreamStage = { id: crypto.randomUUID(), ...params };
    await serverUpsertEntity<ValueStreamStage>(ctx.userId, KIND_VS, stage);
    return { added: true, id: stage.id };
  },
});
