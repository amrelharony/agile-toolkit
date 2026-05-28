/**
 * AI Feature Spec — tool-local actions.
 *
 * Category: AI / LLM Product Management (squad S12b)
 * Tool:     A PRD variant for AI features — model choice, eval criteria,
 *           fallback, latency/cost budgets, human-in-the-loop, rollout.
 *
 * Agent surface: tool.ai_feature_spec.*
 * Backing CRUD : workspace.ai_feature_spec.* (auto-generated). Singleton:
 *                one spec document under a fixed id.
 *
 *   1. list_state  — the spec doc + completeness (filled / total fields).
 *   2. update_spec — merge any subset of the 11 fields; creates the doc if
 *                    absent. Additive merge → no confirmation.
 *
 * Entity kind "workspace:aiFeatureSpec" (kindFromToolId of
 * "workspace.ai_feature_spec") + the fixed SPEC_ID match the client, so MCP
 * writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { AiFeatureSpec } from "@/lib/stores/workspace-types";

const KIND_SPEC = "workspace:aiFeatureSpec";
// MUST match SPEC_ID in ai-feature-spec-client.tsx.
const SPEC_ID = "aiFeatureSpec:current";

/** The 11 free-text fields, in display order. Mirrors the client's FIELDS. */
const FIELDS = [
  "featureName",
  "problem",
  "modelChoice",
  "evalCriteria",
  "fallback",
  "latencyBudgetMs",
  "hallucinationTolerance",
  "costBudget",
  "humanLoop",
  "rolloutPlan",
  "successMetric",
] as const;

const ws = () => useWorkspaceStore.getState();

function emptySpec(): AiFeatureSpec {
  return {
    id: SPEC_ID,
    featureName: "",
    problem: "",
    modelChoice: "",
    evalCriteria: "",
    fallback: "",
    latencyBudgetMs: "",
    hallucinationTolerance: "",
    costBudget: "",
    humanLoop: "",
    rolloutPlan: "",
    successMetric: "",
  };
}

function browserSpec(): AiFeatureSpec | null {
  return (ws().aiFeatureSpecs ?? []).find((s) => s.id === SPEC_ID) ?? null;
}

function summarize(spec: AiFeatureSpec | null) {
  const filledFields = spec ? FIELDS.filter((f) => (spec[f] ?? "").trim().length > 0).length : 0;
  return {
    exists: spec !== null,
    spec: spec ?? emptySpec(),
    filledFields,
    totalFields: FIELDS.length,
    completeness: Math.round((filledFields / FIELDS.length) * 100) / 100,
  };
}

// Partial-update schema — every field optional so the agent can set one or
// many at a time. `.partial()` keeps the field names advertised to MCP.
const UpdateSchema = z.object({
  featureName: z.string().max(400).optional(),
  problem: z.string().max(4000).optional(),
  modelChoice: z.string().max(4000).optional(),
  evalCriteria: z.string().max(4000).optional(),
  fallback: z.string().max(4000).optional(),
  latencyBudgetMs: z.string().max(400).optional(),
  hallucinationTolerance: z.string().max(4000).optional(),
  costBudget: z.string().max(4000).optional(),
  humanLoop: z.string().max(4000).optional(),
  rolloutPlan: z.string().max(4000).optional(),
  successMetric: z.string().max(4000).optional(),
});

// ──────── tool.ai_feature_spec.list_state ────────
registry.register({
  id: "tool.ai_feature_spec.list_state",
  toolId: "tool.ai_feature_spec",
  name: "list_state",
  category: "read",
  description:
    "Read the AI feature spec. Returns {exists, spec (all 11 fields; defaults to blanks when none saved), filledFields, totalFields, completeness (0..1)}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserSpec()),
  mcpHandler: async (_params, ctx) => {
    const spec = await serverGetEntity<AiFeatureSpec>(ctx.userId, KIND_SPEC, SPEC_ID);
    return summarize(spec ?? null);
  },
});

// ──────── tool.ai_feature_spec.update_spec ────────
registry.register({
  id: "tool.ai_feature_spec.update_spec",
  toolId: "tool.ai_feature_spec",
  name: "update_spec",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set one or more spec fields (merge — omitted fields are left untouched). Creates the spec if it doesn't exist yet. Returns {updated: true}.",
  paramsSchema: UpdateSchema,
  handler: async (params) => {
    const base = browserSpec() ?? emptySpec();
    ws().upsertAiFeatureSpec({ ...base, ...params, id: SPEC_ID });
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<AiFeatureSpec>(ctx.userId, KIND_SPEC, SPEC_ID)) ?? emptySpec();
    await serverUpsertEntity<AiFeatureSpec>(ctx.userId, KIND_SPEC, {
      ...base,
      ...params,
      id: SPEC_ID,
    });
    return { updated: true };
  },
});
