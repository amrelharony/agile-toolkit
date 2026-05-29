/**
 * Psychological Safety Assessment — tool-local actions.
 *
 * Category: Team Health & Maturity (squad S4)
 * Tool:     Edmondson 7-question survey; reversed-adjusted team score vs an
 *           org benchmark, per-question averages, and a half-over-half anomaly.
 *
 * Agent surface: tool.psych_safety.*
 * Backing CRUD : workspace.psych_safety_log.* (auto-generated). Singleton:
 *                one PsychSafetyLog document (responses[]) under a fixed id.
 *
 *   1. list_state      — score summary (teamScore, perQuestion, lowest, anomaly).
 *   2. log_response    — record a 7-question response (1-5 each). ts → now.
 *   3. remove_response — drop a response by id.
 *
 * Entity kind "workspace:psychSafety" + the fixed PS_ID match
 * psych-safety-client.tsx, so MCP writes round-trip into the UI. The
 * reversed-adjusted math mirrors the client exactly (single source: scoreTeam).
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type {
  PsychSafetyLog,
  PsychSafetyResponse,
  PsychSafetyQuestionId,
} from "@/lib/stores/workspace-types";

const KIND_PS = "workspace:psychSafety";
// MUST match PS_ID in psych-safety-client.tsx.
const PS_ID = "psychSafety:current";
const ORG_BENCHMARK = 4.0;

/** Reversed questions (q1/q3/q5) flip 1-5 to 5-1; mirrors the client. */
const QUESTION_META: { id: PsychSafetyQuestionId; reversed: boolean }[] = [
  { id: "q1", reversed: true },
  { id: "q2", reversed: false },
  { id: "q3", reversed: true },
  { id: "q4", reversed: false },
  { id: "q5", reversed: true },
  { id: "q6", reversed: false },
  { id: "q7", reversed: false },
];

const ws = () => useWorkspaceStore.getState();

function emptyDoc(): PsychSafetyLog {
  return { id: PS_ID, responses: [] };
}

function browserDoc(): PsychSafetyLog | null {
  return (ws().psychSafetyLogs ?? []).find((d) => d.id === PS_ID) ?? null;
}

function adjustedScore(raw: number, reversed: boolean): number {
  return reversed ? 6 - raw : raw;
}

function mean(vals: number[]): number {
  return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Per-question reversed-adjusted average across a set of responses. */
function perQuestion(responses: PsychSafetyResponse[]) {
  return QUESTION_META.map((q) => {
    const avg = mean(responses.map((r) => r.scores[q.id]));
    return { id: q.id, avg, reversedScore: adjustedScore(avg, q.reversed) };
  });
}

/** Team score = mean of the reversed-adjusted per-question averages. */
function scoreTeam(responses: PsychSafetyResponse[]): number {
  if (responses.length === 0) return 0;
  const pq = perQuestion(responses);
  return mean(pq.map((q) => q.reversedScore));
}

function summarize(doc: PsychSafetyLog | null) {
  const responses = doc?.responses ?? [];
  const pq = perQuestion(responses);
  const teamScore = scoreTeam(responses);

  const lowest =
    responses.length === 0
      ? undefined
      : pq.reduce((acc, q) => (q.reversedScore < acc.reversedScore ? q : acc), pq[0]);

  // Anomaly: split chronologically into halves; flag a >0.5 score drop.
  let delta: number | undefined;
  let anomaly = false;
  if (responses.length >= 4) {
    const sorted = [...responses].sort((a, b) => a.ts.localeCompare(b.ts));
    const midpoint = Math.floor(sorted.length / 2);
    const prior = scoreTeam(sorted.slice(0, midpoint));
    const recent = scoreTeam(sorted.slice(midpoint));
    delta = recent - prior;
    anomaly = delta < -0.5;
  }

  return {
    exists: doc !== null,
    totalResponses: responses.length,
    teamScore,
    benchmark: ORG_BENCHMARK,
    perQuestion: pq,
    lowestQuestionId: lowest?.id,
    delta,
    anomaly,
    responses,
  };
}

const scoreSchema = z.object({
  q1: z.number().min(1).max(5),
  q2: z.number().min(1).max(5),
  q3: z.number().min(1).max(5),
  q4: z.number().min(1).max(5),
  q5: z.number().min(1).max(5),
  q6: z.number().min(1).max(5),
  q7: z.number().min(1).max(5),
});

function newResponse(params: {
  scores: Record<PsychSafetyQuestionId, number>;
  respondent?: string;
  description?: string;
}): PsychSafetyResponse {
  const respondent = params.respondent?.trim();
  const description = params.description?.trim();
  return {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    scores: { ...params.scores },
    respondent: respondent ? respondent : undefined,
    description: description ? description : undefined,
  };
}

// ──────── tool.psych_safety.list_state ────────
registry.register({
  id: "tool.psych_safety.list_state",
  toolId: "tool.psych_safety",
  name: "list_state",
  category: "read",
  description:
    "Summarise the psychological-safety survey. Returns {exists, totalResponses, teamScore (reversed-adjusted mean, /5), benchmark, perQuestion: {id, avg, reversedScore}[], lowestQuestionId, delta (recent vs prior half; undefined < 4 responses), anomaly (delta < -0.5), responses}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<PsychSafetyLog>(ctx.userId, KIND_PS, PS_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.psych_safety.log_response ────────
registry.register({
  id: "tool.psych_safety.log_response",
  toolId: "tool.psych_safety",
  name: "log_response",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record one survey response. scores must hold all 7 questions (q1-q7), each 1-5 raw Likert (q1/q3/q5 are reverse-scored automatically). respondent/description optional. Creates the log if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    scores: scoreSchema,
    respondent: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const r = newResponse(params);
    ws().upsertPsychSafetyLog({ ...base, id: PS_ID, responses: [...base.responses, r] });
    return { added: true, id: r.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<PsychSafetyLog>(ctx.userId, KIND_PS, PS_ID)) ?? emptyDoc();
    const r = newResponse(params);
    await serverUpsertEntity<PsychSafetyLog>(ctx.userId, KIND_PS, {
      ...base,
      id: PS_ID,
      responses: [...base.responses, r],
    });
    return { added: true, id: r.id };
  },
});

// ──────── tool.psych_safety.remove_response ────────
registry.register({
  id: "tool.psych_safety.remove_response",
  toolId: "tool.psych_safety",
  name: "remove_response",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a response by id. Returns {removed: false} when the id is unknown, else {removed: true}.",
  paramsSchema: z.object({ id: z.string() }),
  handler: async (params) => {
    const doc = browserDoc();
    if (!doc || !doc.responses.some((r) => r.id === params.id)) return { removed: false };
    ws().upsertPsychSafetyLog({
      ...doc,
      id: PS_ID,
      responses: doc.responses.filter((r) => r.id !== params.id),
    });
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const doc = await serverGetEntity<PsychSafetyLog>(ctx.userId, KIND_PS, PS_ID);
    if (!doc || !doc.responses.some((r) => r.id === params.id)) return { removed: false };
    await serverUpsertEntity<PsychSafetyLog>(ctx.userId, KIND_PS, {
      ...doc,
      id: PS_ID,
      responses: doc.responses.filter((r) => r.id !== params.id),
    });
    return { removed: true };
  },
});
