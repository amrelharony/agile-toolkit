/**
 * Runbook Scorer — tool-local actions.
 *
 * Category: Incidents & Reliability (squad S8)
 * Tool:     Hygiene scoring (freshness / completeness / tested) across runbooks.
 *
 * Agent surface: tool.runbook_scorer.*
 * Backing CRUD : workspace.runbook_scorer.* (auto-generated). Singleton: one
 *                RunbookScorer document (runbooks[]) under a fixed id.
 *
 *   1. list_state     — runbooks + total + avgHygiene.
 *   2. add_runbook    — add a runbook (scores default to 3, untested).
 *   3. score_runbook  — patch freshness/completeness/testedRecently by id.
 *   4. remove_runbook — delete a runbook by id.
 *
 * Hygiene = (freshness + completeness + (testedRecently ? 5 : 1)) / 3, matching
 * runbook-scorer-client.tsx. Entity kind "workspace:runbookScorer" + the fixed
 * RS_ID match the client, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { RunbookScorer, Runbook, ScoreValue } from "@/lib/stores/workspace-types";

const KIND_RS = "workspace:runbookScorer";
// MUST match RS_ID in runbook-scorer-client.tsx.
const RS_ID = "runbookScorer:current";

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;

function hygiene(r: Runbook): number {
  return (r.freshness + r.completeness + (r.testedRecently ? 5 : 1)) / 3;
}

function emptyDoc(): RunbookScorer {
  return { id: RS_ID, runbooks: [] };
}

function browserDoc(): RunbookScorer | null {
  return (ws().runbookScorers ?? []).find((d) => d.id === RS_ID) ?? null;
}

function summarize(doc: RunbookScorer | null) {
  const runbooks = doc?.runbooks ?? [];
  const avgHygiene = runbooks.length
    ? round2(runbooks.reduce((a, r) => a + hygiene(r), 0) / runbooks.length)
    : 0;
  return { exists: doc !== null, total: runbooks.length, avgHygiene, runbooks };
}

// ──────── tool.runbook_scorer.list_state ────────
registry.register({
  id: "tool.runbook_scorer.list_state",
  toolId: "tool.runbook_scorer",
  name: "list_state",
  category: "read",
  description:
    "Summarise the runbook scorecard. Returns {exists, total, avgHygiene (mean of (freshness+completeness+(tested?5:1))/3), runbooks: {id, name, owner, freshness, completeness, testedRecently}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<RunbookScorer>(ctx.userId, KIND_RS, RS_ID);
    return summarize(doc ?? null);
  },
});

const addParams = z.object({
  name: z.string().min(1).max(200),
  owner: z.string().max(200).optional(),
  freshness: z.number().int().min(1).max(5).optional(),
  completeness: z.number().int().min(1).max(5).optional(),
  testedRecently: z.boolean().optional(),
  description: z.string().max(2000).optional(),
});

// ──────── tool.runbook_scorer.add_runbook ────────
registry.register({
  id: "tool.runbook_scorer.add_runbook",
  toolId: "tool.runbook_scorer",
  name: "add_runbook",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a runbook. freshness/completeness are 1..5 (default 3); testedRecently defaults to false. Creates the scorecard if absent. Returns {added: false} when the name is blank, else {added: true, id}.",
  paramsSchema: addParams,
  handler: async (params) => {
    if (!params.name.trim()) return { added: false };
    const base = browserDoc() ?? emptyDoc();
    const runbook = newRunbook(params);
    ws().upsertRunbookScorer({ ...base, id: RS_ID, runbooks: [runbook, ...base.runbooks] });
    return { added: true, id: runbook.id };
  },
  mcpHandler: async (params, ctx) => {
    // Whitespace-only passes min(1); the UI trims and refuses a blank name.
    if (!params.name.trim()) return { added: false };
    const base = (await serverGetEntity<RunbookScorer>(ctx.userId, KIND_RS, RS_ID)) ?? emptyDoc();
    const runbook = newRunbook(params);
    await serverUpsertEntity<RunbookScorer>(ctx.userId, KIND_RS, {
      ...base,
      id: RS_ID,
      runbooks: [runbook, ...base.runbooks],
    });
    return { added: true, id: runbook.id };
  },
});

const scoreParams = z.object({
  runbookId: z.string(),
  freshness: z.number().int().min(1).max(5).optional(),
  completeness: z.number().int().min(1).max(5).optional(),
  testedRecently: z.boolean().optional(),
});

// ──────── tool.runbook_scorer.score_runbook ────────
registry.register({
  id: "tool.runbook_scorer.score_runbook",
  toolId: "tool.runbook_scorer",
  name: "score_runbook",
  category: "write",
  requiresConfirmation: false,
  description:
    "Patch a runbook's freshness/completeness (1..5) and/or testedRecently by id. Returns {updated: false} when the scorecard or runbook id is unknown.",
  paramsSchema: scoreParams,
  handler: async (params) => {
    const next = applyScore(browserDoc(), params);
    if (!next) return { updated: false };
    ws().upsertRunbookScorer(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<RunbookScorer>(ctx.userId, KIND_RS, RS_ID);
    const next = applyScore(base ?? null, params);
    if (!next) return { updated: false };
    await serverUpsertEntity<RunbookScorer>(ctx.userId, KIND_RS, next);
    return { updated: true };
  },
});

// ──────── tool.runbook_scorer.remove_runbook ────────
registry.register({
  id: "tool.runbook_scorer.remove_runbook",
  toolId: "tool.runbook_scorer",
  name: "remove_runbook",
  category: "write",
  requiresConfirmation: false,
  description: "Delete a runbook by id. Returns {removed: false} when the id is unknown.",
  paramsSchema: z.object({ runbookId: z.string() }),
  handler: async (params) => {
    const next = applyRemove(browserDoc(), params.runbookId);
    if (!next) return { removed: false };
    ws().upsertRunbookScorer(next);
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<RunbookScorer>(ctx.userId, KIND_RS, RS_ID);
    const next = applyRemove(base ?? null, params.runbookId);
    if (!next) return { removed: false };
    await serverUpsertEntity<RunbookScorer>(ctx.userId, KIND_RS, next);
    return { removed: true };
  },
});

function newRunbook(params: z.infer<typeof addParams>): Runbook {
  return {
    id: crypto.randomUUID(),
    name: params.name.trim(),
    owner: params.owner,
    freshness: (params.freshness ?? 3) as ScoreValue,
    completeness: (params.completeness ?? 3) as ScoreValue,
    testedRecently: params.testedRecently ?? false,
    description: params.description,
  };
}

function applyScore(
  doc: RunbookScorer | null,
  params: z.infer<typeof scoreParams>
): RunbookScorer | null {
  if (!doc || !doc.runbooks.some((r) => r.id === params.runbookId)) return null;
  return {
    ...doc,
    runbooks: doc.runbooks.map((r) =>
      r.id === params.runbookId
        ? {
            ...r,
            ...(params.freshness !== undefined
              ? { freshness: params.freshness as ScoreValue }
              : {}),
            ...(params.completeness !== undefined
              ? { completeness: params.completeness as ScoreValue }
              : {}),
            ...(params.testedRecently !== undefined
              ? { testedRecently: params.testedRecently }
              : {}),
          }
        : r
    ),
  };
}

function applyRemove(doc: RunbookScorer | null, runbookId: string): RunbookScorer | null {
  if (!doc || !doc.runbooks.some((r) => r.id === runbookId)) return null;
  return { ...doc, runbooks: doc.runbooks.filter((r) => r.id !== runbookId) };
}
