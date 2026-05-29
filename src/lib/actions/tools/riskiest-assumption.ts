/**
 * Riskiest Assumption Canvas — tool-local actions.
 *
 * Category: Workshops & Facilitation (squad S11)
 * Tool:     List assumptions, rank by risk (high risk × low evidence), and
 *           generate test cards.
 *
 * Agent surface: tool.riskiest_assumption.*
 * Backing CRUD : workspace.riskiest_assumption.* (auto-generated). Singleton:
 *                one canvas document (assumptions[]) under a fixed id.
 *
 *   1. list_state       — assumptions + byStatus + the single riskiest one.
 *   2. add_assumption   — log an assumption (status → untested).
 *   3. set_status       — move an assumption through its validation lifecycle.
 *
 * Entity kind "workspace:riskiestAssumption" + the fixed RA_ID match
 * riskiest-assumption-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type {
  RiskiestAssumption,
  Assumption,
  AssumptionLevel,
  AssumptionStatus,
} from "@/lib/stores/workspace-types";

const KIND_RA = "workspace:riskiestAssumption";
// MUST match RA_ID in riskiest-assumption-client.tsx.
const RA_ID = "riskiestAssumption:current";

const STATUSES = ["untested", "testing", "validated", "invalidated"] as const;
const StatusSchema = z.enum(STATUSES);
const LevelSchema = z.number().int().min(1).max(5);

const ws = () => useWorkspaceStore.getState();

function emptyDoc(): RiskiestAssumption {
  return { id: RA_ID, assumptions: [] };
}

function browserDoc(): RiskiestAssumption | null {
  return (ws().riskiestAssumptions ?? []).find((d) => d.id === RA_ID) ?? null;
}

function summarize(doc: RiskiestAssumption | null) {
  const assumptions = doc?.assumptions ?? [];
  const byStatus: Record<AssumptionStatus, number> = {
    untested: 0,
    testing: 0,
    validated: 0,
    invalidated: 0,
  };
  for (const a of assumptions) if (a.status in byStatus) byStatus[a.status] += 1;
  // The "riskiest" assumption to test first = highest risk AND lowest
  // evidence. Score = riskLevel - evidenceLevel; ties broken by higher risk.
  // Only consider not-yet-resolved (untested/testing) assumptions.
  const candidates = assumptions.filter((a) => a.status === "untested" || a.status === "testing");
  let riskiest: Assumption | null = null;
  let bestScore = -Infinity;
  for (const a of candidates) {
    const score = a.riskLevel - a.evidenceLevel;
    if (
      score > bestScore ||
      (score === bestScore && riskiest && a.riskLevel > riskiest.riskLevel)
    ) {
      bestScore = score;
      riskiest = a;
    }
  }
  return {
    exists: doc !== null,
    total: assumptions.length,
    byStatus,
    riskiest: riskiest
      ? {
          id: riskiest.id,
          statement: riskiest.statement,
          riskLevel: riskiest.riskLevel,
          evidenceLevel: riskiest.evidenceLevel,
        }
      : null,
    assumptions,
  };
}

// ──────── tool.riskiest_assumption.list_state ────────
registry.register({
  id: "tool.riskiest_assumption.list_state",
  toolId: "tool.riskiest_assumption",
  name: "list_state",
  category: "read",
  description:
    "Summarise the riskiest-assumption canvas. Returns {exists, total, byStatus: {untested, testing, validated, invalidated}, riskiest (the unresolved assumption with highest risk − evidence, or null), assumptions}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<RiskiestAssumption>(ctx.userId, KIND_RA, RA_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.riskiest_assumption.add_assumption ────────
registry.register({
  id: "tool.riskiest_assumption.add_assumption",
  toolId: "tool.riskiest_assumption",
  name: "add_assumption",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add an assumption. riskLevel + evidenceLevel are 1..5 (high risk + low evidence = test first). status defaults to 'untested'. Creates the canvas if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    statement: z.string().min(1).max(1000),
    riskLevel: LevelSchema,
    evidenceLevel: LevelSchema,
    testIdea: z.string().max(2000).optional(),
    status: StatusSchema.optional(),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const a = newAssumption(params);
    ws().upsertRiskiestAssumption({ ...base, id: RA_ID, assumptions: [...base.assumptions, a] });
    return { added: true, id: a.id };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<RiskiestAssumption>(ctx.userId, KIND_RA, RA_ID)) ?? emptyDoc();
    const a = newAssumption(params);
    await serverUpsertEntity<RiskiestAssumption>(ctx.userId, KIND_RA, {
      ...base,
      id: RA_ID,
      assumptions: [...base.assumptions, a],
    });
    return { added: true, id: a.id };
  },
});

// ──────── tool.riskiest_assumption.set_status ────────
registry.register({
  id: "tool.riskiest_assumption.set_status",
  toolId: "tool.riskiest_assumption",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set an assumption's status (untested | testing | validated | invalidated). Returns {updated: false} when the canvas or assumption id is unknown.",
  paramsSchema: z.object({
    assumptionId: z.string(),
    status: StatusSchema,
  }),
  handler: async (params) => {
    const next = applyStatus(browserDoc(), params.assumptionId, params.status);
    if (!next) return { updated: false };
    ws().upsertRiskiestAssumption(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<RiskiestAssumption>(ctx.userId, KIND_RA, RA_ID);
    const next = applyStatus(base ?? null, params.assumptionId, params.status);
    if (!next) return { updated: false };
    await serverUpsertEntity<RiskiestAssumption>(ctx.userId, KIND_RA, next);
    return { updated: true };
  },
});

function newAssumption(params: {
  statement: string;
  riskLevel: number;
  evidenceLevel: number;
  testIdea?: string;
  status?: AssumptionStatus;
  description?: string;
}): Assumption {
  return {
    id: crypto.randomUUID(),
    statement: params.statement,
    riskLevel: params.riskLevel as AssumptionLevel,
    evidenceLevel: params.evidenceLevel as AssumptionLevel,
    testIdea: params.testIdea,
    status: params.status ?? "untested",
    description: params.description,
  };
}

function applyStatus(
  doc: RiskiestAssumption | null,
  assumptionId: string,
  status: AssumptionStatus
): RiskiestAssumption | null {
  if (!doc || !doc.assumptions.some((a) => a.id === assumptionId)) return null;
  return {
    ...doc,
    assumptions: doc.assumptions.map((a) => (a.id === assumptionId ? { ...a, status } : a)),
  };
}
