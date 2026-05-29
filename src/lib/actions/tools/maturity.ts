/**
 * Agile Maturity Assessment — tool-local actions.
 *
 * Category: Team Health & Maturity (squad S4)
 * Tool:     Rate 8 Agile dimensions 1-5; radar + overall % + improvement roadmap.
 *
 * Agent surface: tool.maturity.*
 * Backing CRUD : workspace.maturity_assessment.* (auto-generated). Singleton:
 *                one MaturityAssessment document (flat scores + targetLevel)
 *                under a fixed id.
 *
 *   1. list_state       — scores, average, overall %/label, improvement roadmap.
 *   2. set_score        — set a dimension's level (1-5); refuses unknown dim.
 *   3. set_target_level — set the improvement target (2-5).
 *   4. reset            — back to all-level-1 / target 4.
 *
 * Entity kind "workspace:maturityAssessment" + the fixed MATURITY_ID match
 * maturity-client.tsx, so MCP writes round-trip into the UI. Average/%/roadmap
 * reuse the client's MATURITY_DIMENSIONS + getMaturityScore (single source).
 * NOTE: the client separately derives workspace.maturityLevel from the average
 * via a useEffect — that derivation stays client-side and is untouched here.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { MaturityAssessment } from "@/lib/stores/workspace-types";
import { MATURITY_DIMENSIONS, getMaturityScore } from "@/lib/constants/maturity-model";

const KIND_M = "workspace:maturityAssessment";
// MUST match MATURITY_ID in maturity-client.tsx.
const MATURITY_ID = "maturity:current";
const DEFAULT_TARGET = 4;

const KNOWN_DIM_IDS = new Set(MATURITY_DIMENSIONS.map((d) => d.id));

const ws = () => useWorkspaceStore.getState();

function defaultScores(): Record<string, number> {
  return Object.fromEntries(MATURITY_DIMENSIONS.map((d) => [d.id, 1]));
}

function emptyDoc(): MaturityAssessment {
  return { id: MATURITY_ID, scores: defaultScores(), targetLevel: DEFAULT_TARGET };
}

function browserDoc(): MaturityAssessment | null {
  return (ws().maturityAssessments ?? []).find((d) => d.id === MATURITY_ID) ?? null;
}

/** Persisted/agent-supplied levels can drift; clamp into the valid 1-5 band. */
function clampLevel(level: number): number {
  return Math.min(5, Math.max(1, level));
}

function summarize(doc: MaturityAssessment | null) {
  const scores = doc?.scores ?? defaultScores();
  const targetLevel = doc?.targetLevel ?? DEFAULT_TARGET;
  const levels = MATURITY_DIMENSIONS.map((d) => clampLevel(scores[d.id] ?? 1));
  const averageLevel = levels.reduce((a, b) => a + b, 0) / levels.length;
  const { percentage, label } = getMaturityScore(averageLevel);

  const clampedTarget = clampLevel(targetLevel);
  const roadmap = MATURITY_DIMENSIONS.filter(
    (d) => clampLevel(scores[d.id] ?? 1) < clampedTarget
  ).map((d) => {
    const current = clampLevel(scores[d.id] ?? 1);
    const next = d.levels.find((l) => l.level === current + 1);
    return {
      dimensionId: d.id,
      name: d.name,
      current,
      nextLevel: next
        ? { level: next.level, label: next.label, description: next.description }
        : undefined,
    };
  });

  return { exists: doc !== null, scores, targetLevel, averageLevel, percentage, label, roadmap };
}

// ──────── tool.maturity.list_state ────────
registry.register({
  id: "tool.maturity.list_state",
  toolId: "tool.maturity",
  name: "list_state",
  category: "read",
  description:
    "Summarise the agile maturity assessment. Returns {exists, scores (dimensionId -> level 1-5), targetLevel, averageLevel (/5), percentage, label, roadmap: {dimensionId, name, current, nextLevel?: {level, label, description}}[] (dimensions below the target)}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<MaturityAssessment>(ctx.userId, KIND_M, MATURITY_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.maturity.set_score ────────
registry.register({
  id: "tool.maturity.set_score",
  toolId: "tool.maturity",
  name: "set_score",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set one dimension's maturity level (1-5). dimensionId must be one of the 8 known dimensions (scrum-practices, team-collaboration, technical-excellence, product-management, metrics-transparency, continuous-improvement, stakeholder-engagement, agile-culture). Creates the assessment if absent. Returns {set: false} for an unknown dimensionId, else {set: true}.",
  paramsSchema: z.object({
    dimensionId: z.string(),
    level: z.number().int().min(1).max(5),
  }),
  handler: async (params) => {
    if (!KNOWN_DIM_IDS.has(params.dimensionId)) return { set: false };
    const base = browserDoc() ?? emptyDoc();
    ws().upsertMaturityAssessment({
      ...base,
      id: MATURITY_ID,
      scores: { ...base.scores, [params.dimensionId]: params.level },
    });
    return { set: true };
  },
  mcpHandler: async (params, ctx) => {
    if (!KNOWN_DIM_IDS.has(params.dimensionId)) return { set: false };
    const base =
      (await serverGetEntity<MaturityAssessment>(ctx.userId, KIND_M, MATURITY_ID)) ?? emptyDoc();
    await serverUpsertEntity<MaturityAssessment>(ctx.userId, KIND_M, {
      ...base,
      id: MATURITY_ID,
      scores: { ...base.scores, [params.dimensionId]: params.level },
    });
    return { set: true };
  },
});

// ──────── tool.maturity.set_target_level ────────
registry.register({
  id: "tool.maturity.set_target_level",
  toolId: "tool.maturity",
  name: "set_target_level",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the improvement target level (2-5). Dimensions scoring below it appear on the roadmap. Returns {set: true, targetLevel}.",
  paramsSchema: z.object({ level: z.number().int().min(2).max(5) }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    ws().upsertMaturityAssessment({ ...base, id: MATURITY_ID, targetLevel: params.level });
    return { set: true, targetLevel: params.level };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<MaturityAssessment>(ctx.userId, KIND_M, MATURITY_ID)) ?? emptyDoc();
    await serverUpsertEntity<MaturityAssessment>(ctx.userId, KIND_M, {
      ...base,
      id: MATURITY_ID,
      targetLevel: params.level,
    });
    return { set: true, targetLevel: params.level };
  },
});

// ──────── tool.maturity.reset ────────
registry.register({
  id: "tool.maturity.reset",
  toolId: "tool.maturity",
  name: "reset",
  category: "write",
  requiresConfirmation: false,
  description:
    "Reset all 8 dimensions to level 1 and the target to level 4. Returns {reset: true}.",
  paramsSchema: z.object({}),
  handler: async () => {
    ws().upsertMaturityAssessment(emptyDoc());
    return { reset: true };
  },
  mcpHandler: async (_params, ctx) => {
    await serverUpsertEntity<MaturityAssessment>(ctx.userId, KIND_M, emptyDoc());
    return { reset: true };
  },
});
