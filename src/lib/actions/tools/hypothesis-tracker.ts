/**
 * Hypothesis Tracker — tool-local actions.
 *
 * Category: Product Discovery (squad S5)
 * Tool:     Lean-startup hypotheses (believe / will do / to learn / success
 *           metric) with a validation lifecycle.
 *
 * Agent surface: tool.hypothesis_tracker.*
 * Backing CRUD : workspace.hypothesis_tracker.* (auto-generated). Singleton:
 *                one HypothesisTracker document (hypotheses[]) under a fixed id.
 *
 *   1. list_state       — byStatus + validation rate.
 *   2. add_hypothesis   — log a hypothesis (status → drafted, raisedAt → today).
 *   3. set_status       — move through the lifecycle; stamps resolvedAt when
 *                         validated/invalidated/inconclusive.
 *
 * Entity kind "workspace:hypothesisTracker" + the fixed HT_ID match
 * hypothesis-tracker-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { HypothesisTracker, Hypothesis, HypothesisStatus } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

const KIND_HT = "workspace:hypothesisTracker";
// MUST match HT_ID in hypothesis-tracker-client.tsx.
const HT_ID = "hypothesisTracker:current";

const STATUSES = ["drafted", "running", "validated", "invalidated", "inconclusive"] as const;
const StatusSchema = z.enum(STATUSES);
const RESOLVED: ReadonlySet<HypothesisStatus> = new Set<HypothesisStatus>([
  "validated",
  "invalidated",
  "inconclusive",
]);

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;
// Local calendar day, matching the client's todayLocalISO() stamps.
const today = () => todayLocalISO();

function emptyDoc(): HypothesisTracker {
  return { id: HT_ID, hypotheses: [] };
}

function browserDoc(): HypothesisTracker | null {
  return (ws().hypothesisTrackers ?? []).find((d) => d.id === HT_ID) ?? null;
}

function summarize(doc: HypothesisTracker | null) {
  const hypotheses = doc?.hypotheses ?? [];
  const byStatus: Record<HypothesisStatus, number> = {
    drafted: 0,
    running: 0,
    validated: 0,
    invalidated: 0,
    inconclusive: 0,
  };
  for (const h of hypotheses) if (h.status in byStatus) byStatus[h.status] += 1;
  // Validation rate = validated over decisive (validated + invalidated);
  // inconclusive/drafted/running excluded. 0 when none decisive.
  const decisive = byStatus.validated + byStatus.invalidated;
  return {
    exists: doc !== null,
    total: hypotheses.length,
    byStatus,
    validationRate: decisive ? round2(byStatus.validated / decisive) : 0,
    hypotheses,
  };
}

// ──────── tool.hypothesis_tracker.list_state ────────
registry.register({
  id: "tool.hypothesis_tracker.list_state",
  toolId: "tool.hypothesis_tracker",
  name: "list_state",
  category: "read",
  description:
    "Summarise hypotheses. Returns {exists, total, byStatus: {drafted, running, validated, invalidated, inconclusive}, validationRate (0..1, validated over decisive), hypotheses}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<HypothesisTracker>(ctx.userId, KIND_HT, HT_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.hypothesis_tracker.add_hypothesis ────────
registry.register({
  id: "tool.hypothesis_tracker.add_hypothesis",
  toolId: "tool.hypothesis_tracker",
  name: "add_hypothesis",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a hypothesis (We believe ___ / will do ___ / to learn ___ / success = ___). status defaults to 'drafted'; raisedAt to today. Creates the tracker if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    believe: z.string().min(1).max(2000),
    willDo: z.string().min(1).max(2000),
    toLearn: z.string().min(1).max(2000),
    successMetric: z.string().min(1).max(2000),
    experiment: z.string().max(2000).optional(),
    description: z.string().max(2000).optional(),
    status: StatusSchema.optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const h = newHypothesis(params);
    ws().upsertHypothesisTracker({ ...base, id: HT_ID, hypotheses: [...base.hypotheses, h] });
    return { added: true, id: h.id };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<HypothesisTracker>(ctx.userId, KIND_HT, HT_ID)) ?? emptyDoc();
    const h = newHypothesis(params);
    await serverUpsertEntity<HypothesisTracker>(ctx.userId, KIND_HT, {
      ...base,
      id: HT_ID,
      hypotheses: [...base.hypotheses, h],
    });
    return { added: true, id: h.id };
  },
});

// ──────── tool.hypothesis_tracker.set_status ────────
registry.register({
  id: "tool.hypothesis_tracker.set_status",
  toolId: "tool.hypothesis_tracker",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a hypothesis's status (drafted | running | validated | invalidated | inconclusive). Stamps resolvedAt on a terminal status. Returns {updated: false} when the tracker or hypothesis id is unknown.",
  paramsSchema: z.object({
    hypothesisId: z.string(),
    status: StatusSchema,
  }),
  handler: async (params) => {
    const next = applyStatus(browserDoc(), params.hypothesisId, params.status);
    if (!next) return { updated: false };
    ws().upsertHypothesisTracker(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<HypothesisTracker>(ctx.userId, KIND_HT, HT_ID);
    const next = applyStatus(base ?? null, params.hypothesisId, params.status);
    if (!next) return { updated: false };
    await serverUpsertEntity<HypothesisTracker>(ctx.userId, KIND_HT, next);
    return { updated: true };
  },
});

function newHypothesis(params: {
  believe: string;
  willDo: string;
  toLearn: string;
  successMetric: string;
  experiment?: string;
  description?: string;
  status?: HypothesisStatus;
}): Hypothesis {
  const status = params.status ?? "drafted";
  return {
    id: crypto.randomUUID(),
    believe: params.believe,
    willDo: params.willDo,
    toLearn: params.toLearn,
    successMetric: params.successMetric,
    experiment: params.experiment,
    description: params.description,
    status,
    raisedAt: today(),
    // Added already resolved → stamp it, as set_status does.
    resolvedAt: RESOLVED.has(status) ? today() : undefined,
  };
}

function applyStatus(
  doc: HypothesisTracker | null,
  hypothesisId: string,
  status: HypothesisStatus
): HypothesisTracker | null {
  if (!doc || !doc.hypotheses.some((h) => h.id === hypothesisId)) return null;
  return {
    ...doc,
    hypotheses: doc.hypotheses.map((h) => {
      if (h.id !== hypothesisId) return h;
      return {
        ...h,
        status,
        resolvedAt: RESOLVED.has(status) ? (h.resolvedAt ?? today()) : undefined,
      };
    }),
  };
}
