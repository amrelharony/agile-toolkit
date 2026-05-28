/**
 * SLO & Error Budget Builder — tool-local actions.
 *
 * Category: Engineering Excellence (squad S7)
 * Tool:     Define SLI/SLO targets and track error-budget burn.
 *
 * Agent surface: tool.slo_builder.*
 * Backing CRUD : workspace.slo_builder.* (auto-generated). Singleton: one
 *                SloBuilder document (slos[] + burns[]) under a fixed id.
 *
 *   1. list_state            — per-SLO error budget + burned + remaining.
 *   2. compute_error_budget  — pure: target + windowDays → budget minutes.
 *   3. add_slo               — define an SLO.
 *   4. record_burn           — log error-minutes against an existing SLO.
 *
 * Entity kind "workspace:sloBuilder" + the fixed SB_ID match
 * slo-builder-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { SloBuilder, SloDefinition, SloBurn } from "@/lib/stores/workspace-types";

const KIND_SLO = "workspace:sloBuilder";
// MUST match SB_ID in slo-builder-client.tsx.
const SB_ID = "sloBuilder:current";

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Error-budget minutes = allowed unavailability over the window =
 *  (1 - target) × windowDays × 24h × 60m. */
function budgetMinutes(target: number, windowDays: number): number {
  return (1 - target) * windowDays * 24 * 60;
}

function emptyDoc(): SloBuilder {
  return { id: SB_ID, slos: [], burns: [] };
}

function browserDoc(): SloBuilder | null {
  return (ws().sloBuilders ?? []).find((d) => d.id === SB_ID) ?? null;
}

function summarize(doc: SloBuilder | null) {
  const slos = doc?.slos ?? [];
  const burns = doc?.burns ?? [];
  const perSlo = slos.map((slo) => {
    const budget = budgetMinutes(slo.target, slo.windowDays);
    const burned = burns.filter((b) => b.sloId === slo.id).reduce((a, b) => a + b.errorMinutes, 0);
    return {
      sloId: slo.id,
      name: slo.name,
      target: slo.target,
      windowDays: slo.windowDays,
      budgetMinutes: round2(budget),
      burnedMinutes: round2(burned),
      budgetRemainingMinutes: round2(budget - burned),
      budgetBurnedPct: budget > 0 ? round2(burned / budget) : 0,
    };
  });
  return {
    exists: doc !== null,
    sloCount: slos.length,
    burnCount: burns.length,
    slos,
    perSlo,
  };
}

// ──────── tool.slo_builder.list_state ────────
registry.register({
  id: "tool.slo_builder.list_state",
  toolId: "tool.slo_builder",
  name: "list_state",
  category: "read",
  description:
    "Summarise SLOs + error-budget burn. Returns {exists, sloCount, burnCount, slos, perSlo: {sloId, name, target, windowDays, budgetMinutes, burnedMinutes, budgetRemainingMinutes, budgetBurnedPct}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<SloBuilder>(ctx.userId, KIND_SLO, SB_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.slo_builder.compute_error_budget ────────
// Pure: target (0..1) + windowDays → allowed error minutes over the window.
registry.register({
  id: "tool.slo_builder.compute_error_budget",
  toolId: "tool.slo_builder",
  name: "compute_error_budget",
  category: "read",
  description:
    "Compute the error budget for an SLO: (1 - target) × windowDays × 24 × 60 minutes. Returns {budgetMinutes}. Pure — no persistence.",
  paramsSchema: z.object({
    target: z.number().min(0).max(1).describe("0..1, e.g. 0.999 for 99.9%."),
    windowDays: z.number().positive(),
  }),
  handler: async (params) => ({
    budgetMinutes: round2(budgetMinutes(params.target, params.windowDays)),
  }),
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.slo_builder.add_slo ────────
registry.register({
  id: "tool.slo_builder.add_slo",
  toolId: "tool.slo_builder",
  name: "add_slo",
  category: "write",
  requiresConfirmation: false,
  description:
    "Define an SLO. target is 0..1 (e.g. 0.999); windowDays is the rolling window. Creates the doc if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    name: z.string().min(1).max(200),
    sliDescription: z.string().min(1).max(1000),
    target: z.number().min(0).max(1),
    windowDays: z.number().positive(),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const slo: SloDefinition = { id: crypto.randomUUID(), ...params };
    ws().upsertSloBuilder({ ...base, id: SB_ID, slos: [...base.slos, slo] });
    return { added: true, id: slo.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<SloBuilder>(ctx.userId, KIND_SLO, SB_ID)) ?? emptyDoc();
    const slo: SloDefinition = { id: crypto.randomUUID(), ...params };
    await serverUpsertEntity<SloBuilder>(ctx.userId, KIND_SLO, {
      ...base,
      id: SB_ID,
      slos: [...base.slos, slo],
    });
    return { added: true, id: slo.id };
  },
});

// ──────── tool.slo_builder.record_burn ────────
// Refuses to record against an unknown SLO (an orphan burn would never show
// in any SLO's budget). Additive → no confirmation.
registry.register({
  id: "tool.slo_builder.record_burn",
  toolId: "tool.slo_builder",
  name: "record_burn",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record error-minutes against an existing SLO (date defaults to today). Returns {added: false} when the sloId is unknown, else {added: true, id}.",
  paramsSchema: z.object({
    sloId: z.string(),
    errorMinutes: z.number().min(0),
    date: z.string().optional().describe("YYYY-MM-DD; defaults to today."),
  }),
  handler: async (params) => {
    const base = browserDoc();
    if (!base || !base.slos.some((s) => s.id === params.sloId)) return { added: false };
    const burn = newBurn(params);
    ws().upsertSloBuilder({ ...base, id: SB_ID, burns: [...base.burns, burn] });
    return { added: true, id: burn.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<SloBuilder>(ctx.userId, KIND_SLO, SB_ID);
    if (!base || !base.slos.some((s) => s.id === params.sloId)) return { added: false };
    const burn = newBurn(params);
    await serverUpsertEntity<SloBuilder>(ctx.userId, KIND_SLO, {
      ...base,
      id: SB_ID,
      burns: [...base.burns, burn],
    });
    return { added: true, id: burn.id };
  },
});

function newBurn(params: { sloId: string; errorMinutes: number; date?: string }): SloBurn {
  return {
    id: crypto.randomUUID(),
    sloId: params.sloId,
    errorMinutes: params.errorMinutes,
    date: params.date ?? new Date().toISOString().slice(0, 10),
  };
}
