/**
 * SPACE Pulse — tool-local actions.
 *
 * Category: Engineering Excellence (squad S7)
 * Tool:     Quarterly self-rated SPACE survey (satisfaction, performance,
 *           activity, communication, efficiency).
 *
 * Agent surface: tool.space_pulse.*
 * Backing CRUD : workspace.space_pulse.* (auto-generated). Singleton: one
 *                SpacePulse document (scores[]) under a fixed id.
 *
 *   1. list_state — scores + latest + per-dimension averages + overall.
 *   2. add_score  — record a quarterly SPACE score (each dimension 1..5).
 *
 * Entity kind "workspace:spacePulse" + the fixed SP_ID match
 * space-pulse-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { SpacePulse, SpaceScore } from "@/lib/stores/workspace-types";

const KIND_SPACE = "workspace:spacePulse";
// MUST match SP_ID in space-pulse-client.tsx.
const SP_ID = "spacePulse:current";

const DIMS = ["satisfaction", "performance", "activity", "communication", "efficiency"] as const;

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyDoc(): SpacePulse {
  return { id: SP_ID, scores: [] };
}

function browserDoc(): SpacePulse | null {
  return (ws().spacePulses ?? []).find((d) => d.id === SP_ID) ?? null;
}

function summarize(doc: SpacePulse | null) {
  const scores = doc?.scores ?? [];
  const avg = (sel: (s: SpaceScore) => number) =>
    scores.length ? round2(scores.reduce((a, s) => a + sel(s), 0) / scores.length) : 0;
  const averages = {
    satisfaction: avg((s) => s.satisfaction),
    performance: avg((s) => s.performance),
    activity: avg((s) => s.activity),
    communication: avg((s) => s.communication),
    efficiency: avg((s) => s.efficiency),
  };
  const overall = scores.length
    ? round2(DIMS.reduce((a, d) => a + averages[d], 0) / DIMS.length)
    : 0;
  return {
    exists: doc !== null,
    total: scores.length,
    latest: scores.length ? scores[scores.length - 1] : null,
    averages: { ...averages, overall },
    scores,
  };
}

// ──────── tool.space_pulse.list_state ────────
registry.register({
  id: "tool.space_pulse.list_state",
  toolId: "tool.space_pulse",
  name: "list_state",
  category: "read",
  description:
    "Summarise the SPACE pulse. Returns {exists, total, latest (| null), averages: {satisfaction, performance, activity, communication, efficiency, overall} (1..5), scores}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<SpacePulse>(ctx.userId, KIND_SPACE, SP_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.space_pulse.add_score ────────
registry.register({
  id: "tool.space_pulse.add_score",
  toolId: "tool.space_pulse",
  name: "add_score",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a quarterly SPACE score. Each dimension is 1 (low) … 5 (high). Creates the doc if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    quarter: z.string().min(1).max(50),
    satisfaction: z.number().int().min(1).max(5),
    performance: z.number().int().min(1).max(5),
    activity: z.number().int().min(1).max(5),
    communication: z.number().int().min(1).max(5),
    efficiency: z.number().int().min(1).max(5),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const score: SpaceScore = { id: crypto.randomUUID(), ...params };
    ws().upsertSpacePulse({ ...base, id: SP_ID, scores: [...base.scores, score] });
    return { added: true, id: score.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<SpacePulse>(ctx.userId, KIND_SPACE, SP_ID)) ?? emptyDoc();
    const score: SpaceScore = { id: crypto.randomUUID(), ...params };
    await serverUpsertEntity<SpacePulse>(ctx.userId, KIND_SPACE, {
      ...base,
      id: SP_ID,
      scores: [...base.scores, score],
    });
    return { added: true, id: score.id };
  },
});
