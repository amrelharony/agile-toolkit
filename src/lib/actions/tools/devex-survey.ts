/**
 * DevEx Survey — tool-local actions.
 *
 * Category: Engineering Excellence (squad S7)
 * Tool:     Lightweight developer-experience survey (flow state, feedback
 *           loops, cognitive load).
 *
 * Agent surface: tool.devex_survey.*
 * Backing CRUD : workspace.devex_survey.* (auto-generated). Singleton: one
 *                DevexSurvey document (responses[]) under a fixed id.
 *
 *   1. list_state       — responses + per-metric averages.
 *   2. record_response  — log one survey response (each metric 1..5).
 *
 * Entity kind "workspace:devexSurvey" + the fixed DX_ID match
 * devex-survey-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { DevexSurvey, DevexResponse } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

const KIND_DEVEX = "workspace:devexSurvey";
// MUST match DX_ID in devex-survey-client.tsx.
const DX_ID = "devexSurvey:current";

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyDoc(): DevexSurvey {
  return { id: DX_ID, responses: [] };
}

function browserDoc(): DevexSurvey | null {
  return (ws().devexSurveys ?? []).find((d) => d.id === DX_ID) ?? null;
}

function summarize(doc: DevexSurvey | null) {
  const responses = doc?.responses ?? [];
  const avg = (sel: (r: DevexResponse) => number) =>
    responses.length ? round2(responses.reduce((a, r) => a + sel(r), 0) / responses.length) : 0;
  return {
    exists: doc !== null,
    total: responses.length,
    averages: {
      flowState: avg((r) => r.flowState),
      feedbackLoops: avg((r) => r.feedbackLoops),
      // Higher cognitiveLoad = worse, so a high average flags a problem.
      cognitiveLoad: avg((r) => r.cognitiveLoad),
    },
    responses,
  };
}

// ──────── tool.devex_survey.list_state ────────
registry.register({
  id: "tool.devex_survey.list_state",
  toolId: "tool.devex_survey",
  name: "list_state",
  category: "read",
  description:
    "Summarise the DevEx survey. Returns {exists, total, averages: {flowState, feedbackLoops, cognitiveLoad} (1..5; cognitiveLoad higher = worse), responses}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<DevexSurvey>(ctx.userId, KIND_DEVEX, DX_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.devex_survey.record_response ────────
registry.register({
  id: "tool.devex_survey.record_response",
  toolId: "tool.devex_survey",
  name: "record_response",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a DevEx survey response. flowState/feedbackLoops/cognitiveLoad are 1..5 (cognitiveLoad higher = more load = worse). respondent defaults to '' (anonymous); date defaults to today. Creates the doc if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    flowState: z.number().int().min(1).max(5),
    feedbackLoops: z.number().int().min(1).max(5),
    cognitiveLoad: z.number().int().min(1).max(5),
    respondent: z.string().max(200).optional(),
    date: z.string().optional().describe("YYYY-MM-DD; defaults to today."),
    comments: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const response = newResponse(params);
    ws().upsertDevexSurvey({ ...base, id: DX_ID, responses: [...base.responses, response] });
    return { added: true, id: response.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<DevexSurvey>(ctx.userId, KIND_DEVEX, DX_ID)) ?? emptyDoc();
    const response = newResponse(params);
    await serverUpsertEntity<DevexSurvey>(ctx.userId, KIND_DEVEX, {
      ...base,
      id: DX_ID,
      responses: [...base.responses, response],
    });
    return { added: true, id: response.id };
  },
});

function newResponse(params: {
  flowState: number;
  feedbackLoops: number;
  cognitiveLoad: number;
  respondent?: string;
  date?: string;
  comments?: string;
}): DevexResponse {
  return {
    id: crypto.randomUUID(),
    respondent: params.respondent ?? "",
    // Local calendar day, as the form uses: toISOString() is UTC and gave
    // yesterday's date just after local midnight east of UTC.
    date: params.date ?? todayLocalISO(),
    flowState: params.flowState,
    feedbackLoops: params.feedbackLoops,
    cognitiveLoad: params.cognitiveLoad,
    comments: params.comments,
  };
}
