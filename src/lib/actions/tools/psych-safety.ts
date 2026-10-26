/**
 * Psychological Safety Assessment — tool-local actions.
 *
 * Category: Team Health & Maturity (squad S4)
 * Tool:     Edmondson's seven-statement survey, taken in rounds. A round is
 *           kept only as counts per question (how many answered 1-5), from a
 *           vote room or typed in by the facilitator; its results show from
 *           five answers, and two rounds can be compared.
 *
 * Agent surface: tool.psych_safety.*
 * Backing CRUD : workspace.psych_safety_log.* (auto-generated, kind
 *                "workspace:psychSafety"). Singleton: one PsychSafetyLog
 *                document under PSYCH_SAFETY_ID.
 *
 *   1. list_state      — the rounds, their results and the latest comparison.
 *   2. log_round       — save a round's counts (totals only, from 5 people).
 *   3. remove_round    — remove a round.
 *   4. log_response    — deprecated: refused (answers per person are no
 *                        longer kept); use log_round.
 *   5. remove_response — deprecated: removes one answer sheet from the list
 *                        kept before rounds.
 *
 * The scoring is lib/psych-safety/instrument's, as on the page: reverse
 * scoring for q1, q3 and q5, results from PSYCH_SAFETY_MIN_RESPONSES, the
 * per-response list from before rounds read as one "legacy" round. Nothing
 * per person is returned, and no benchmark: the tool had an uncited 4.0.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { PsychSafetyLog, PsychSafetyRound, Sprint } from "@/lib/stores/workspace-types";
import {
  PSYCH_SAFETY_ID,
  PSYCH_SAFETY_MIN_RESPONSES,
  PSYCH_SAFETY_QUESTIONS,
  PSYCH_SAFETY_SCALE,
  ROUND_NAME_MAX,
  checkRoundCounts,
  compareRounds,
  emptyPsychSafetyLog,
  roundDateProblem,
  roundResult,
  roundsOf,
  withRound,
  withoutRound,
} from "@/lib/psych-safety/instrument";

const KIND_PS = "workspace:psychSafety";
const KIND_SPRINT = "workspace:sprint";

const ws = () => useWorkspaceStore.getState();

interface PsychSafetyStore {
  getDoc(): Promise<PsychSafetyLog | null>;
  putDoc(doc: PsychSafetyLog): Promise<void>;
  listSprints(): Promise<Sprint[]>;
}

const browserStore: PsychSafetyStore = {
  getDoc: async () => (ws().psychSafetyLogs ?? []).find((d) => d.id === PSYCH_SAFETY_ID) ?? null,
  putDoc: async (doc) => ws().upsertPsychSafetyLog(doc),
  listSprints: async () => ws().sprints ?? [],
};

function serverStore(userId: string): PsychSafetyStore {
  return {
    getDoc: async () =>
      (await serverGetEntity<PsychSafetyLog>(userId, KIND_PS, PSYCH_SAFETY_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<PsychSafetyLog>(userId, KIND_PS, doc);
    },
    listSprints: () => serverListEntities<Sprint>(userId, KIND_SPRINT),
  };
}

/* ── list_state ─────────────────────────────────────────────────────── */

const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

function roundRow(r: PsychSafetyRound) {
  const result = roundResult(r);
  return {
    id: r.id,
    name: r.name,
    date: r.date,
    sprintId: r.sprintId ?? null,
    source: r.source,
    responses: r.responses,
    teamScore: result ? round2(result.teamScore) : null,
    perQuestion: result
      ? result.perQuestion.map((q) => ({
          id: q.id,
          n: q.n,
          mean: round2(q.mean),
          adjusted: round2(q.adjusted),
        }))
      : null,
    lowestQuestionId: result?.lowest ?? null,
    withheld: result?.withheld ?? null,
    readOnly: r.source === "legacy",
  };
}

function summarize(doc: PsychSafetyLog | null) {
  const rounds = roundsOf(doc);
  const latest = rounds[rounds.length - 1] ?? null;
  const previous = rounds[rounds.length - 2] ?? null;
  const cmp = compareRounds(previous, latest);
  const latestRow = latest ? roundRow(latest) : null;
  return {
    exists: doc !== null,
    minResponses: PSYCH_SAFETY_MIN_RESPONSES,
    questions: PSYCH_SAFETY_QUESTIONS.map((q) => ({
      id: q.id,
      text: q.text,
      reversed: q.reversed,
    })),
    scale: PSYCH_SAFETY_SCALE.points,
    rounds: rounds.map(roundRow),
    latestId: latest?.id ?? null,
    previousId: previous?.id ?? null,
    comparison: cmp
      ? {
          delta: round2(cmp.delta),
          perQuestion: cmp.perQuestion.map((q) => ({ id: q.id, delta: round2(q.delta) })),
          anomaly: cmp.anomaly,
          dropped: cmp.dropped,
        }
      : null,
    // The latest round's, under the names the action always returned.
    totalResponses: rounds.reduce((sum, r) => sum + r.responses, 0),
    teamScore: latestRow?.teamScore ?? null,
    perQuestion: latestRow?.perQuestion ?? null,
    lowestQuestionId: latestRow?.lowestQuestionId ?? null,
    delta: cmp ? round2(cmp.delta) : null,
    anomaly: cmp?.anomaly ?? false,
  };
}

registry.register({
  id: "tool.psych_safety.list_state",
  toolId: "tool.psych_safety",
  name: "list_state",
  category: "read",
  description:
    "Summarise the psychological-safety survey as the page shows it: rounds of counts, never answers per person, and no benchmark. Returns {exists, minResponses (5), questions: {id q1-q7, text, reversed}[], scale: {value 1-5, label}[], rounds: {id, name, date, sprintId|null, source: room|facilitator|legacy, responses, teamScore (1-5, reverse-scored mean)|null, perQuestion: {id, n, mean (raw 1-5)|null, adjusted (reverse-scored; higher is safer)|null}[]|null, lowestQuestionId|null, withheld: string[]|null, readOnly}[] oldest first (results are null below 5 responses; a question below 5 answers is withheld), latestId, previousId, comparison: {delta, perQuestion: {id, delta}[], anomaly (a question fell by more than 0.5), dropped: string[]}|null (latest vs previous, both from 5 responses), totalResponses (all rounds), teamScore, perQuestion, lowestQuestionId (the latest round's), delta, anomaly}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.getDoc()),
  mcpHandler: async (_params, ctx) => summarize(await serverStore(ctx.userId).getDoc()),
});

/* ── log_round ──────────────────────────────────────────────────────── */

const countsRow = z.array(z.number().int().min(0).max(999)).length(5);

const logRoundParams = z.object({
  name: z.string().min(1).max(ROUND_NAME_MAX),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sprintId: z.string().max(128).optional(),
  counts: z
    .object({
      q1: countsRow,
      q2: countsRow,
      q3: countsRow,
      q4: countsRow,
      q5: countsRow,
      q6: countsRow,
      q7: countsRow,
    })
    .describe(
      "Per question, how many answered 1, 2, 3, 4 and 5 (raw; reverse scoring is applied when read)."
    ),
  responses: z
    .number()
    .int()
    .min(0)
    .max(999)
    .optional()
    .describe("People who answered; default the question with the most answers."),
});

async function logRound(store: PsychSafetyStore, params: z.infer<typeof logRoundParams>) {
  const today = todayLocalISO();
  const date = params.date ?? today;
  const dateProblem = roundDateProblem(date, today);
  if (dateProblem) return { added: false, reason: dateProblem };
  if (params.sprintId) {
    const sprints = await store.listSprints();
    if (!sprints.some((s) => s.id === params.sprintId)) {
      return { added: false, reason: `No sprint with id "${params.sprintId}".` };
    }
  }
  const checked = checkRoundCounts(params.counts, params.responses);
  if (!checked.ok) return { added: false, reason: checked.reason };
  const round: PsychSafetyRound = {
    id: `psRound_${nanoid(8)}`,
    name: params.name.trim(),
    date,
    ...(params.sprintId ? { sprintId: params.sprintId } : {}),
    source: "facilitator",
    responses: checked.responses,
    counts: checked.counts,
    createdAt: new Date().toISOString(),
  };
  const doc = (await store.getDoc()) ?? emptyPsychSafetyLog();
  await store.putDoc(withRound(doc, round));
  const result = roundResult(round);
  return {
    added: true,
    id: round.id,
    teamScore: result ? round2(result.teamScore) : null,
    withheld: result?.withheld ?? [],
  };
}

registry.register({
  id: "tool.psych_safety.log_round",
  toolId: "tool.psych_safety",
  name: "log_round",
  category: "write",
  requiresConfirmation: false,
  description:
    "Save a survey round as totals only (answers counted by hand or on paper), as the page's count entry does. Params: {name (≤80), date?: YYYY-MM-DD (not in the future; default today), sprintId? (an existing sprint), counts: {q1..q7: [n1, n2, n3, n4, n5]} (how many answered 1-5, raw), responses? (people who answered; default the most answers any question has)}. Needs at least 5 people (so no one's answers can be singled out) and no question with more answers than people; a question with fewer than 5 answers is kept as unanswered. Returns {added: true, id, teamScore, withheld} or {added: false, reason}.",
  paramsSchema: logRoundParams,
  handler: (params) => logRound(browserStore, params),
  mcpHandler: (params, ctx) => logRound(serverStore(ctx.userId), params),
});

/* ── remove_round ───────────────────────────────────────────────────── */

async function removeRound(store: PsychSafetyStore, id: string) {
  const next = withoutRound(await store.getDoc(), id);
  if (!next) return { removed: false };
  await store.putDoc(next);
  return { removed: true };
}

registry.register({
  id: "tool.psych_safety.remove_round",
  toolId: "tool.psych_safety",
  name: "remove_round",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a round by id (from list_state). Removing the read-only 'legacy' round (psRound_legacy) clears the answer list kept before rounds. The page offers Undo; an agent's removal is final, so confirm with the user first. Returns {removed: true} or {removed: false} for an unknown id.",
  paramsSchema: z.object({ id: z.string() }),
  handler: (params) => removeRound(browserStore, params.id),
  mcpHandler: (params, ctx) => removeRound(serverStore(ctx.userId), params.id),
});

/* ── Deprecated: per-response verbs ─────────────────────────────────── */

const LOG_RESPONSE_REFUSAL =
  "Answers per person are no longer kept: in a small team a timestamp and a score row identify the person. Count the answers and save them as a round with tool.psych_safety.log_round (from 5 people).";

registry.register({
  id: "tool.psych_safety.log_response",
  toolId: "tool.psych_safety",
  name: "log_response",
  category: "write",
  requiresConfirmation: false,
  description:
    "Deprecated: refused. Answers per person are no longer kept; save a round's counts with tool.psych_safety.log_round instead. Returns {added: false, reason}.",
  paramsSchema: z.object({
    scores: z.record(z.string(), z.number()).optional(),
    respondent: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
  }),
  handler: async () => ({ added: false, reason: LOG_RESPONSE_REFUSAL }),
  mcpHandler: async () => ({ added: false, reason: LOG_RESPONSE_REFUSAL }),
});

async function removeResponse(store: PsychSafetyStore, id: string) {
  const doc = await store.getDoc();
  if (!doc || !(doc.responses ?? []).some((r) => r.id === id)) return { removed: false };
  await store.putDoc({ ...doc, responses: doc.responses.filter((r) => r.id !== id) });
  return { removed: true };
}

registry.register({
  id: "tool.psych_safety.remove_response",
  toolId: "tool.psych_safety",
  name: "remove_response",
  category: "write",
  requiresConfirmation: false,
  description:
    "Deprecated: remove one answer sheet, by id, from the list kept before rounds (it is read as the 'legacy' round; list_state no longer lists sheets, so use an id you already have, or remove_round psRound_legacy to clear them all). Returns {removed: true} or {removed: false} for an unknown id.",
  paramsSchema: z.object({ id: z.string() }),
  handler: (params) => removeResponse(browserStore, params.id),
  mcpHandler: (params, ctx) => removeResponse(serverStore(ctx.userId), params.id),
});
