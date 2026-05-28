/**
 * NPS / CSAT Tracker — tool-local actions.
 *
 * Category: Outcomes & Pulse (squad S6)
 * Agent surface: tool.nps_csat.*
 * Backing CRUD : workspace.nps_response.* (auto-generated).
 *
 *   1. list_state — every response plus the computed NPS score
 *      (%promoters − %detractors) and CSAT average, with the promoter/
 *      passive/detractor breakdown.
 *   2. record     — add one response (auto id + date), the verb an agent
 *      reaches for instead of marshalling a full entity.
 *
 * Entity kind "workspace:npsResponse" (camelCase via kindFromToolId) matches
 * the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import type { NpsResponse } from "@/lib/stores/workspace-types";

const KIND_NPS = "workspace:npsResponse";

const ws = () => useWorkspaceStore.getState();

/** Standard NPS bucketing: promoter 9–10, passive 7–8, detractor 0–6. */
function summarize(responses: NpsResponse[]) {
  const nps = responses.filter((r) => r.kind === "nps");
  const csat = responses.filter((r) => r.kind === "csat");
  const promoters = nps.filter((r) => r.score >= 9).length;
  const passives = nps.filter((r) => r.score >= 7 && r.score <= 8).length;
  const detractors = nps.filter((r) => r.score <= 6).length;
  const npsScore = nps.length > 0 ? Math.round(((promoters - detractors) / nps.length) * 100) : 0;
  const csatAverage =
    csat.length > 0
      ? Math.round((csat.reduce((a, r) => a + r.score, 0) / csat.length) * 100) / 100
      : 0;
  return {
    total: responses.length,
    nps: { count: nps.length, score: npsScore, promoters, passives, detractors },
    csat: { count: csat.length, average: csatAverage },
  };
}

// ──────── tool.nps_csat.list_state ────────
registry.register({
  id: "tool.nps_csat.list_state",
  toolId: "tool.nps_csat",
  name: "list_state",
  category: "read",
  description:
    "Summarise NPS/CSAT responses. Returns {total, nps: {count, score (−100..100 = %promoters − %detractors), promoters, passives, detractors}, csat: {count, average (1–5)}}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(ws().npsResponses ?? []),
  mcpHandler: async (_params, ctx) => {
    const items = await serverListEntities<NpsResponse>(ctx.userId, KIND_NPS);
    return summarize(items);
  },
});

// ──────── tool.nps_csat.record ────────
registry.register({
  id: "tool.nps_csat.record",
  toolId: "tool.nps_csat",
  name: "record",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record one survey response. kind 'nps' (score 0–10) or 'csat' (score 1–5); date defaults to today. Returns {added: true, id}.",
  paramsSchema: z.object({
    kind: z.enum(["nps", "csat"]),
    score: z.number(),
    respondent: z.string().optional(),
    verbatim: z.string().optional(),
    date: z.string().optional(),
  }),
  handler: async (params) => {
    const entry: NpsResponse = {
      id: crypto.randomUUID(),
      kind: params.kind,
      score: params.score,
      date: params.date ?? new Date().toISOString().slice(0, 10),
      respondent: params.respondent,
      verbatim: params.verbatim,
    };
    ws().upsertNpsResponse(entry);
    return { added: true, id: entry.id };
  },
  mcpHandler: async (params, ctx) => {
    const entry: NpsResponse = {
      id: crypto.randomUUID(),
      kind: params.kind,
      score: params.score,
      date: params.date ?? new Date().toISOString().slice(0, 10),
      respondent: params.respondent,
      verbatim: params.verbatim,
    };
    await serverUpsertEntity<NpsResponse>(ctx.userId, KIND_NPS, entry);
    return { added: true, id: entry.id };
  },
});
