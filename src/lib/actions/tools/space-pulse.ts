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
  // "Latest" is the newest quarter (as the UI shows it), not the last-inserted
  // score: a back-filled older quarter must not become the latest.
  const chronological = [...scores].sort((a, b) => a.quarter.localeCompare(b.quarter));
  return {
    exists: doc !== null,
    total: scores.length,
    latest: chronological.length ? chronological[chronological.length - 1] : null,
    averages: { ...averages, overall },
    scores,
  };
}

/**
 * Add a score, mirroring the client: the quarter is canonicalised to upper case
 * ("2026-q1" -> "2026-Q1") and an existing entry for that quarter is replaced,
 * so a quarter never has two pulses (the trend would compare it with itself).
 */
function addScore(
  base: SpacePulse,
  params: Omit<SpaceScore, "id">
): { next: SpacePulse; id: string; replaced: boolean } {
  const score: SpaceScore = {
    id: crypto.randomUUID(),
    ...params,
    quarter: params.quarter.trim().toUpperCase(),
  };
  const replaced = base.scores.some((s) => s.quarter === score.quarter);
  const scores = replaced
    ? base.scores.map((s) => (s.quarter === score.quarter ? score : s))
    : [...base.scores, score];
  return { next: { ...base, id: SP_ID, scores }, id: score.id, replaced };
}

// ──────── tool.space_pulse.list_state ────────
registry.register({
  id: "tool.space_pulse.list_state",
  toolId: "tool.space_pulse",
  name: "list_state",
  category: "read",
  description:
    "Summarise the SPACE pulse. Returns {exists, total, latest (the newest quarter's score | null), averages: {satisfaction, performance, activity, communication, efficiency, overall} (1..5), scores}.",
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
    "Record a quarterly SPACE score. Each dimension is 1 (low) … 5 (high). quarter is YYYY-QN (case-insensitive); a score for a quarter that already has one replaces it. Creates the doc if absent. Returns {added: true, id, replaced}.",
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
    const { next, id, replaced } = addScore(browserDoc() ?? emptyDoc(), params);
    ws().upsertSpacePulse(next);
    return { added: true, id, replaced };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<SpacePulse>(ctx.userId, KIND_SPACE, SP_ID)) ?? emptyDoc();
    const { next, id, replaced } = addScore(base, params);
    await serverUpsertEntity<SpacePulse>(ctx.userId, KIND_SPACE, next);
    return { added: true, id, replaced };
  },
});
