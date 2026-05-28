/**
 * Platform Engineering Maturity — tool-local actions.
 *
 * Category: Engineering Excellence (squad S7)
 * Tool:     Self-assessment scorecard across 8 platform dimensions (1..5).
 *
 * Agent surface: tool.platform_maturity.*
 * Backing CRUD : workspace.platform_maturity.* (auto-generated). Singleton:
 *                one PlatformMaturity document under a fixed id.
 *
 *   1. list_state     — per-dimension score + note + overall average.
 *   2. set_dimension  — set one dimension's level (1..5) + optional note.
 *
 * The DIMENSIONS list MIRRORS the DimensionId union in
 * platform-maturity-client.tsx — the ids are the contract. Entity kind
 * "workspace:platformMaturity" + the fixed PM_ID match the client.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { PlatformMaturity } from "@/lib/stores/workspace-types";

const KIND_PM = "workspace:platformMaturity";
// MUST match PM_ID in platform-maturity-client.tsx.
const PM_ID = "platformMaturity:current";

/** Fixed dimension ids — MIRRORS the DimensionId union in the client. */
const DIMENSIONS = [
  "goldenPaths",
  "internalDevPlatform",
  "runbookHygiene",
  "onCallMaturity",
  "selfServiceProvisioning",
  "observabilityDefaults",
  "deploymentAutomation",
  "cognitiveLoadReduction",
] as const;
const VALID_IDS = new Set<string>(DIMENSIONS);

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Default assessment: every dimension at level 1 (matches the client). */
function emptyDoc(): PlatformMaturity {
  return {
    id: PM_ID,
    dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, 1])),
    notes: {},
  };
}

function browserDoc(): PlatformMaturity | null {
  return (ws().platformMaturities ?? []).find((d) => d.id === PM_ID) ?? null;
}

function summarize(doc: PlatformMaturity | null) {
  const dimensions = doc?.dimensions ?? {};
  const notes = doc?.notes ?? {};
  // Always report all 8 dimensions; unset ones default to level 1.
  const byDimension = DIMENSIONS.map((id) => ({
    id,
    score: dimensions[id] ?? 1,
    note: notes[id] ?? "",
  }));
  const averageScore = round2(byDimension.reduce((a, d) => a + d.score, 0) / byDimension.length);
  return { exists: doc !== null, averageScore, byDimension };
}

// ──────── tool.platform_maturity.list_state ────────
registry.register({
  id: "tool.platform_maturity.list_state",
  toolId: "tool.platform_maturity",
  name: "list_state",
  category: "read",
  description:
    "Summarise the platform-maturity assessment. Returns {exists, averageScore (1..5), byDimension: {id, score (1..5; unset → 1), note}[]} across the 8 fixed dimensions.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<PlatformMaturity>(ctx.userId, KIND_PM, PM_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.platform_maturity.set_dimension ────────
registry.register({
  id: "tool.platform_maturity.set_dimension",
  toolId: "tool.platform_maturity",
  name: "set_dimension",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set one dimension's maturity level (1..5) and optionally its note. dimensionId must be one of the 8 dimensions (see list_state). Creates the assessment if absent. Returns {updated: false} when the dimensionId is unknown.",
  paramsSchema: z.object({
    dimensionId: z.string(),
    score: z.number().int().min(1).max(5),
    note: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    if (!VALID_IDS.has(params.dimensionId)) return { updated: false };
    const base = browserDoc() ?? emptyDoc();
    ws().upsertPlatformMaturity(applySet(base, params));
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    if (!VALID_IDS.has(params.dimensionId)) return { updated: false };
    const base =
      (await serverGetEntity<PlatformMaturity>(ctx.userId, KIND_PM, PM_ID)) ?? emptyDoc();
    await serverUpsertEntity<PlatformMaturity>(ctx.userId, KIND_PM, applySet(base, params));
    return { updated: true };
  },
});

function applySet(
  base: PlatformMaturity,
  params: { dimensionId: string; score: number; note?: string }
): PlatformMaturity {
  return {
    ...base,
    id: PM_ID,
    dimensions: { ...base.dimensions, [params.dimensionId]: params.score },
    notes:
      params.note !== undefined ? { ...base.notes, [params.dimensionId]: params.note } : base.notes,
  };
}
