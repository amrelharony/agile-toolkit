/**
 * Weighted Decision Matrix (Pugh / MCDA) — tool-local actions.
 *
 * Category: Decision Frameworks
 * Tool:     Named matrices of options scored 1–10 against weighted
 *           criteria; total = Σ score × weight, once every weighted cell
 *           is scored. Rows from before named matrices (no matrixId) are
 *           the default matrix's ("weightedMatrix:default").
 *
 * Agent surface: tool.weighted_decision.*
 *   Matrices, as the page shows them (every number from lib/weighted):
 *   1. list_state       — each matrix with its criteria and shares, every
 *                         option's total or partial total and what's
 *                         missing, the leader, a tie, the weight changes that
 *                         flip the leader, and the verdict.
 *   2. create_matrix    — a named matrix, with the question it answers.
 *   3. add_criterion    — a criterion (weight ≥ 0) in a matrix.
 *   4. set_weight       — change a criterion's weight.
 *   5. add_option       — an option in a matrix.
 *   6. set_score        — one cell, 1–10, or null to clear it.
 *   7. send_to_decision — the matrix's result as a PROPOSED decision record
 *                         (options in rank order, the leader as the
 *                         recommendation; the outcome is the team's).
 *   Kept from before matrices:
 *   8. compute_option_score / 9. compute_and_rank — pure Σ score × weight
 *                         for a rubric the caller supplies (now also say
 *                         which options are complete).
 *   10. list_options    — the stored options, optionally scored with given
 *                         weights; optionally one matrix's.
 *   11. score_and_persist_option / 12. persist_options — write options' raw
 *                         scores; every other stored field (the matrix, the
 *                         note) is kept, off-scale scores are flagged, and a
 *                         matrixId naming no matrix is refused.
 *
 * Entity kinds "workspace:weightedMatrix", "workspace:weightedOption",
 * "workspace:weightedCriterion" and "workspace:decision" match the browser
 * sync and the generic CRUD.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverBulkUpsertEntities,
  serverGetEntity,
  serverListEntities,
  serverUpsertEntity,
} from "../server-store";
import { weightedScore, rank } from "@/lib/analytics/scoring-rubric";
import {
  WEIGHTED_CRITERION_KIND,
  WEIGHTED_MATRIX_KIND,
  WEIGHTED_OPTION_KIND,
  type HandoffLink,
  type WeightedCriterion,
  type WeightedMatrix,
  type WeightedOption,
} from "@/lib/stores/workspace-types";
import { buildDecision, decisionLabel, isDecided } from "@/lib/decisions/model";
import {
  CRITERION_NAME_MAX,
  DEFAULT_WEIGHTED_MATRIX_ID,
  MATRIX_NAME_MAX,
  MATRIX_QUESTION_MAX,
  MEANING_MAX,
  NOTE_MAX,
  OPTION_NAME_MAX,
  SCORE_MAX,
  SCORE_MIN,
  WEIGHT_MAX,
  decisionSourceOf,
  findMatrix,
  isOnScale,
  matricesOf,
  matrixResult,
  mergeOption,
  offScaleScores,
  rowsOf,
  sendBlock,
  sentDecisionOf,
  withSentLink,
} from "@/lib/weighted/model";
import {
  browserDecisionStore,
  createRecord,
  newRecordId,
  serverDecisionStore,
  type DecisionStore,
} from "./decision-log";

const ws = () => useWorkspaceStore.getState();

/** Per-criterion raw scores: `{ criterionId: rawScore }`. */
const ScoresMapSchema = z
  .record(z.string(), z.number())
  .describe(
    `Per-criterion raw scores keyed by criterionId, e.g. {cost: 8, speed: 6}. The page's scale is ${SCORE_MIN}–${SCORE_MAX}: other values are stored but flagged (offScale) and don't count toward a total.`
  );

/** Per-criterion weights for the pure compute verbs. */
const WeightsMapSchema = z
  .record(z.string(), z.number())
  .describe(
    "Per-criterion weights keyed by criterionId, e.g. {cost: 3, speed: 2}. Relative: 2 counts twice as much as 1; not normalised."
  );

const WeightedOptionInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  name: z.string().min(1).max(OPTION_NAME_MAX),
  scores: ScoresMapSchema,
  matrixId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The matrix the option is in (default: the default matrix; an existing option keeps its own)"
    ),
});

function genId(): string {
  return `weightedOpt_${nanoid(8)}`;
}

/* ── The store adapter ───────────────────────────────────────────────── */

interface WeightedStore {
  matrices(): Promise<WeightedMatrix[]>;
  options(): Promise<WeightedOption[]>;
  criteria(): Promise<WeightedCriterion[]>;
  putMatrix(m: WeightedMatrix): Promise<void>;
  putOption(o: WeightedOption): Promise<void>;
  putOptions(list: WeightedOption[]): Promise<void>;
  putCriterion(c: WeightedCriterion): Promise<void>;
  decisions: DecisionStore;
}

const browserStore: WeightedStore = {
  matrices: async () => ws().weightedMatrices ?? [],
  options: async () => ws().weightedOptions ?? [],
  criteria: async () => ws().weightedCriteria ?? [],
  putMatrix: async (m) => ws().upsertWeightedMatrix(m),
  putOption: async (o) => ws().upsertWeightedOption(o),
  putOptions: async (list) => list.forEach((o) => ws().upsertWeightedOption(o)),
  putCriterion: async (c) => ws().upsertWeightedCriterion(c),
  decisions: browserDecisionStore,
};

function serverStore(userId: string): WeightedStore {
  return {
    matrices: () => serverListEntities<WeightedMatrix>(userId, WEIGHTED_MATRIX_KIND),
    options: () => serverListEntities<WeightedOption>(userId, WEIGHTED_OPTION_KIND),
    criteria: () => serverListEntities<WeightedCriterion>(userId, WEIGHTED_CRITERION_KIND),
    putMatrix: async (m) => {
      await serverUpsertEntity<WeightedMatrix>(userId, WEIGHTED_MATRIX_KIND, m);
    },
    putOption: async (o) => {
      await serverUpsertEntity<WeightedOption>(userId, WEIGHTED_OPTION_KIND, o);
    },
    putOptions: async (list) => {
      await serverBulkUpsertEntities<WeightedOption>(userId, WEIGHTED_OPTION_KIND, list);
    },
    putCriterion: async (c) => {
      await serverUpsertEntity<WeightedCriterion>(userId, WEIGHTED_CRITERION_KIND, c);
    },
    decisions: serverDecisionStore(userId),
  };
}

/** A matrix id that exists (a stored matrix, or the default one), or null. */
async function knownMatrix(store: WeightedStore, id: string | undefined): Promise<string | null> {
  const matrixId = id ?? DEFAULT_WEIGHTED_MATRIX_ID;
  if (matrixId === DEFAULT_WEIGHTED_MATRIX_ID) return matrixId;
  return (await store.matrices()).some((m) => m.id === matrixId) ? matrixId : null;
}

/** A row's matrixId for a new row: none for the default matrix, as legacy rows have it. */
const matrixIdFor = (id: string) => (id === DEFAULT_WEIGHTED_MATRIX_ID ? {} : { matrixId: id });

/* ── list_state ──────────────────────────────────────────────────────── */

async function listState(store: WeightedStore, matrixId?: string) {
  const [stored, options, criteria, { records }] = await Promise.all([
    store.matrices(),
    store.options(),
    store.criteria(),
    store.decisions.list(),
  ]);
  const all = matricesOf(stored, options, criteria);
  const picked = matrixId ? all.filter((m) => m.id === matrixId) : all;
  return {
    matrices: picked.map((m) => {
      const result = matrixResult(m.id, criteria, options);
      // As the page's link: a record deleted since reads as not sent.
      const sent = sentDecisionOf(m, records);
      return {
        ...m,
        ...result,
        criteria: result.criteria,
        sentToDecision: sent?.id ?? null,
        sentDecision: sent
          ? {
              id: sent.id,
              label: decisionLabel(sent),
              status: sent.status,
              decided: isDecided(sent.status),
            }
          : null,
      };
    }),
    count: picked.length,
  };
}

registry.register({
  id: "tool.weighted_decision.list_state",
  toolId: "tool.weighted_decision",
  name: "list_state",
  category: "read",
  description:
    "List the weighted-decision matrices with the same numbers the page shows. Params: matrixId? (one matrix; 'weightedMatrix:default' is the matrix of rows from before names). Returns {matrices: (WeightedMatrix & {weightSum, criteria [{id,name,weight,active,share,low?,high?}], options [{id,name,total (null until every weighted cell is scored), partialTotal, unscored, offScale, complete, rank}], leaderId (the highest complete total; never an incomplete option), tie {ids, gap} | null (within 5% of the leader), overtakers [{id, name, partialTotal, minTotal, unscored}] (unfinished options whose lowest possible total, every empty cell at 1, already beats the leader's: the lead isn't the result yet), sensitivity [{criterionId, criterion, changePct, direction, weightAt, newLeaderId, newLeader}] (the smallest weight change within ±50% that flips the leader), sensitivityChecked, emptyCells, verdict, sentToDecision (the record's id while it exists, else null), sentDecision {id, label, status, decided} | null})[], count}.",
  paramsSchema: z.object({ matrixId: z.string().optional() }),
  handler: async (params) => listState(browserStore, params.matrixId),
  mcpHandler: async (params, ctx) => listState(serverStore(ctx.userId), params.matrixId),
});

/* ── create_matrix ───────────────────────────────────────────────────── */

const CreateMatrixSchema = z.object({
  name: z.string().trim().min(1).max(MATRIX_NAME_MAX),
  question: z
    .string()
    .trim()
    .max(MATRIX_QUESTION_MAX)
    .optional()
    .describe("What is being decided; becomes the decision record's title"),
});

async function createMatrix(store: WeightedStore, p: z.infer<typeof CreateMatrixSchema>) {
  const m: WeightedMatrix = {
    id: `weightedMatrix_${nanoid(8)}`,
    name: p.name.trim(),
    ...(p.question?.trim() ? { question: p.question.trim() } : {}),
    createdAt: new Date().toISOString(),
  };
  await store.putMatrix(m);
  return { id: m.id };
}

registry.register({
  id: "tool.weighted_decision.create_matrix",
  toolId: "tool.weighted_decision",
  name: "create_matrix",
  category: "write",
  requiresConfirmation: false,
  description:
    "Create a named weighted-decision matrix. Params: name, question? (what is being decided). Returns {id}; pass it as matrixId to add_criterion and add_option.",
  paramsSchema: CreateMatrixSchema,
  handler: async (params) => createMatrix(browserStore, params),
  mcpHandler: async (params, ctx) => createMatrix(serverStore(ctx.userId), params),
});

/* ── add_criterion / set_weight ──────────────────────────────────────── */

const AddCriterionSchema = z.object({
  matrixId: z.string().min(1).optional().describe("Default: the default matrix"),
  name: z.string().trim().min(1).max(CRITERION_NAME_MAX),
  weight: z
    .number()
    .min(0)
    .max(WEIGHT_MAX)
    .describe("Relative weight, 0 or more (0: listed, not counted)"),
  low: z.string().trim().max(MEANING_MAX).optional().describe("What a score of 1 means"),
  high: z.string().trim().max(MEANING_MAX).optional().describe("What a score of 10 means"),
});

async function addCriterion(store: WeightedStore, p: z.infer<typeof AddCriterionSchema>) {
  const matrixId = await knownMatrix(store, p.matrixId);
  if (!matrixId) return { added: false, reason: "matrix_not_found" };
  const taken = rowsOf(matrixId, await store.criteria()).some(
    (c) => c.name.trim().toLowerCase() === p.name.trim().toLowerCase()
  );
  if (taken) return { added: false, reason: "name_taken" };
  const c: WeightedCriterion = {
    id: `weightedCrit_${nanoid(8)}`,
    name: p.name.trim(),
    weight: p.weight,
    ...matrixIdFor(matrixId),
    ...(p.low ? { low: p.low } : {}),
    ...(p.high ? { high: p.high } : {}),
  };
  await store.putCriterion(c);
  return { added: true, id: c.id, matrixId };
}

registry.register({
  id: "tool.weighted_decision.add_criterion",
  toolId: "tool.weighted_decision",
  name: "add_criterion",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a criterion to a matrix. Params: matrixId? (default: the default matrix), name (unique in the matrix), weight (≥ 0, relative), low?/high? (what a 1 and a 10 mean). Returns {added: true, id, matrixId} or {added: false, reason: 'matrix_not_found' | 'name_taken'}.",
  paramsSchema: AddCriterionSchema,
  handler: async (params) => addCriterion(browserStore, params),
  mcpHandler: async (params, ctx) => addCriterion(serverStore(ctx.userId), params),
});

const SetWeightSchema = z.object({
  criterionId: z.string(),
  weight: z.number().min(0).max(WEIGHT_MAX),
});

async function setWeight(store: WeightedStore, p: z.infer<typeof SetWeightSchema>) {
  const c = (await store.criteria()).find((x) => x.id === p.criterionId);
  if (!c) return { updated: false, reason: "criterion_not_found" };
  await store.putCriterion({ ...c, weight: p.weight });
  return { updated: true };
}

registry.register({
  id: "tool.weighted_decision.set_weight",
  toolId: "tool.weighted_decision",
  name: "set_weight",
  category: "write",
  requiresConfirmation: false,
  description:
    "Change a criterion's weight (≥ 0; 0 keeps it listed but not counted). Params: criterionId, weight. Returns {updated: boolean, reason?: 'criterion_not_found'}.",
  paramsSchema: SetWeightSchema,
  handler: async (params) => setWeight(browserStore, params),
  mcpHandler: async (params, ctx) => setWeight(serverStore(ctx.userId), params),
});

/* ── add_option / set_score ──────────────────────────────────────────── */

const AddOptionSchema = z.object({
  matrixId: z.string().min(1).optional().describe("Default: the default matrix"),
  name: z.string().trim().min(1).max(OPTION_NAME_MAX),
  note: z.string().trim().max(NOTE_MAX).optional(),
});

async function addOption(store: WeightedStore, p: z.infer<typeof AddOptionSchema>) {
  const matrixId = await knownMatrix(store, p.matrixId);
  if (!matrixId) return { added: false, reason: "matrix_not_found" };
  const taken = rowsOf(matrixId, await store.options()).some(
    (o) => o.name.trim().toLowerCase() === p.name.trim().toLowerCase()
  );
  if (taken) return { added: false, reason: "name_taken" };
  const o: WeightedOption = {
    id: genId(),
    name: p.name.trim(),
    scores: {},
    ...matrixIdFor(matrixId),
    ...(p.note ? { note: p.note } : {}),
  };
  await store.putOption(o);
  return { added: true, id: o.id, matrixId };
}

registry.register({
  id: "tool.weighted_decision.add_option",
  toolId: "tool.weighted_decision",
  name: "add_option",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add an option (unscored) to a matrix. Params: matrixId? (default: the default matrix), name (unique in the matrix), note?. Returns {added: true, id, matrixId} or {added: false, reason: 'matrix_not_found' | 'name_taken'}.",
  paramsSchema: AddOptionSchema,
  handler: async (params) => addOption(browserStore, params),
  mcpHandler: async (params, ctx) => addOption(serverStore(ctx.userId), params),
});

const SetScoreSchema = z.object({
  optionId: z.string(),
  criterionId: z.string(),
  score: z
    .number()
    .nullable()
    .describe(`${SCORE_MIN}–${SCORE_MAX}, or null to clear the cell (not scored is never 0)`),
});

async function setScore(store: WeightedStore, p: z.infer<typeof SetScoreSchema>) {
  if (p.score !== null && !isOnScale(p.score)) {
    return { updated: false, reason: "off_scale", min: SCORE_MIN, max: SCORE_MAX };
  }
  const [options, criteria] = await Promise.all([store.options(), store.criteria()]);
  const o = options.find((x) => x.id === p.optionId);
  if (!o) return { updated: false, reason: "option_not_found" };
  const c = criteria.find((x) => x.id === p.criterionId);
  if (!c) return { updated: false, reason: "criterion_not_found" };
  const inMatrix = (row: { matrixId?: string }) => row.matrixId || DEFAULT_WEIGHTED_MATRIX_ID;
  if (inMatrix(o) !== inMatrix(c)) return { updated: false, reason: "different_matrix" };
  const scores = { ...o.scores };
  if (p.score === null) delete scores[c.id];
  else scores[c.id] = p.score;
  await store.putOption({ ...o, scores });
  return { updated: true };
}

registry.register({
  id: "tool.weighted_decision.set_score",
  toolId: "tool.weighted_decision",
  name: "set_score",
  category: "write",
  requiresConfirmation: false,
  description: `Score one cell like the page: ${SCORE_MIN}–${SCORE_MAX}, or null to clear it (an empty cell is not scored, never 0). The option and the criterion must be in the same matrix. Params: optionId, criterionId, score. Returns {updated: true} or {updated: false, reason: 'off_scale' | 'option_not_found' | 'criterion_not_found' | 'different_matrix'}.`,
  paramsSchema: SetScoreSchema,
  handler: async (params) => setScore(browserStore, params),
  mcpHandler: async (params, ctx) => setScore(serverStore(ctx.userId), params),
});

/* ── send_to_decision ────────────────────────────────────────────────── */

async function sendToDecision(store: WeightedStore, matrixId: string) {
  const [stored, options, criteria] = await Promise.all([
    store.matrices(),
    store.options(),
    store.criteria(),
  ]);
  const matrix =
    matricesOf(stored, options, criteria).find((m) => m.id === matrixId) ??
    findMatrix(stored, matrixId);
  if (!matrix) return { sent: false, reason: "matrix_not_found" };
  const result = matrixResult(matrix.id, criteria, options);
  const why = sendBlock(matrix, result);
  if (why) return { sent: false, reason: why.reason, message: why.message };
  const { records } = await store.decisions.list();
  const existing = sentDecisionOf(matrix, records);
  if (existing) {
    return {
      sent: false,
      reason: "already_sent",
      decisionId: existing.id,
      label: decisionLabel(existing),
    };
  }
  const record = await createRecord(
    store.decisions,
    buildDecision(decisionSourceOf(matrix, result), newRecordId())
  );
  const sent: HandoffLink = {
    route: "decision",
    targetId: record.id,
    at: new Date().toISOString(),
  };
  await store.putMatrix({
    ...matrix,
    createdAt: matrix.createdAt || new Date().toISOString(),
    sentTo: withSentLink(matrix.sentTo, sent),
  });
  return { sent: true, decisionId: record.id, label: decisionLabel(record), status: record.status };
}

registry.register({
  id: "tool.weighted_decision.send_to_decision",
  toolId: "tool.weighted_decision",
  name: "send_to_decision",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a matrix's result as a PROPOSED decision record in the Decision Log (as the page's 'Send to decision record'): the question as its title, the verdict and ranking as its context, the options in rank order, and the leader as the recommendation (in a tie, the tied options and 'talk it through'); the outcome is left to the team. Needs a fully scored leader that no unfinished option is certain to overtake; once per matrix while that record exists. Params: matrixId. Returns {sent: true, decisionId, label, status: 'proposed'} or {sent: false, reason: 'matrix_not_found' | 'no_leader' | 'overtaken' | 'example' | 'already_sent', message?, decisionId?}.",
  paramsSchema: z.object({ matrixId: z.string() }),
  handler: async (params) => sendToDecision(browserStore, params.matrixId),
  mcpHandler: async (params, ctx) => sendToDecision(serverStore(ctx.userId), params.matrixId),
});

/* ── Kept: the pure compute verbs ────────────────────────────────────── */

/**
 * Rank a list of `{id, name, score}` items by `score` descending and
 * attach `rank` + `percentile` (the shared dense `rank()`, which wants a
 * `title`: `name` goes through it and comes back out).
 */
function rankWeighted<S extends Record<string, number>>(
  items: Array<{ id: string; name: string; scores: S; score: number }>
): Array<{ id: string; name: string; scores: S; score: number; rank: number; percentile: number }> {
  const ranked = rank(
    items.map((it) => ({ id: it.id, title: it.name, fields: it.scores, score: it.score }))
  );
  return ranked.map((r) => ({
    id: r.id,
    name: r.title,
    scores: r.fields,
    score: r.score,
    rank: r.rank,
    percentile: r.percentile,
  }));
}

/** Which weighted criteria (weight > 0) an option has no on-scale score for. */
function unscoredOf(scores: Record<string, number>, weights: Record<string, number>): string[] {
  return Object.entries(weights)
    .filter(([, w]) => Number.isFinite(w) && w > 0)
    .map(([k]) => k)
    .filter((k) => !isOnScale(scores[k]));
}

registry.register({
  id: "tool.weighted_decision.compute_option_score",
  toolId: "tool.weighted_decision",
  name: "compute_option_score",
  category: "read",
  description: `Compute Σ score(criterion) × weight(criterion) for one option against a rubric the caller supplies. Pure: nothing is read or stored. A criterion the option has no score for adds nothing to this raw sum, so check complete: the page shows a Total only when every weighted criterion has a ${SCORE_MIN}–${SCORE_MAX} score. Returns {score, formula, complete, unscored: criterionIds}.`,
  paramsSchema: z.object({
    optionScores: ScoresMapSchema,
    criteriaWeights: WeightsMapSchema,
  }),
  handler: async (params) => {
    const score = weightedScore(params.optionScores, params.criteriaWeights);
    const unscored = unscoredOf(params.optionScores, params.criteriaWeights);
    return { score, formula: "Σ score(c) × weight(c)", complete: unscored.length === 0, unscored };
  },
});

registry.register({
  id: "tool.weighted_decision.compute_and_rank",
  toolId: "tool.weighted_decision",
  name: "compute_and_rank",
  category: "read",
  description:
    "Score a batch of options against a shared rubric and rank them descending (dense rank: ties share a rank). Pure. Each ranked option also says whether it is complete (every weighted criterion scored on the 1–10 scale) and which criteria are unscored: an incomplete option's raw sum isn't comparable, and the page never stars one. Returns {ranked: {id, name, scores, score, rank, percentile, complete, unscored}[], count}.",
  paramsSchema: z.object({
    options: z.array(WeightedOptionInputSchema).min(1).max(500),
    criteriaWeights: WeightsMapSchema,
  }),
  handler: async (params) => {
    const scored = params.options.map((o) => ({
      id: o.id ?? genId(),
      name: o.name,
      scores: o.scores,
      score: weightedScore(o.scores, params.criteriaWeights),
    }));
    const ranked = rankWeighted(scored).map((r) => {
      const unscored = unscoredOf(r.scores, params.criteriaWeights);
      return { ...r, complete: unscored.length === 0, unscored };
    });
    return { ranked, count: ranked.length };
  },
});

/* ── Kept: list_options and the persist verbs ─────────────────────────── */

const ListOptionsSchema = z.object({
  criteriaWeights: WeightsMapSchema.optional(),
  matrixId: z.string().optional().describe("Only this matrix's options"),
});

function listOptions(all: WeightedOption[], p: z.infer<typeof ListOptionsSchema>) {
  const options = p.matrixId ? rowsOf(p.matrixId, all) : all;
  if (!p.criteriaWeights) return { options, count: options.length, ranked: false as const };
  const weights = p.criteriaWeights;
  const ranked = rankWeighted(
    options.map((o) => ({
      id: o.id,
      name: o.name,
      scores: o.scores,
      score: weightedScore(o.scores, weights),
    }))
  );
  return { options: ranked, count: ranked.length, ranked: true as const };
}

registry.register({
  id: "tool.weighted_decision.list_options",
  toolId: "tool.weighted_decision",
  name: "list_options",
  category: "read",
  description:
    "List the stored WeightedOption rows (optionally one matrix's). With criteriaWeights, they come back scored and ranked by the raw Σ score × weight; without, as stored. For the page's own totals, leader and tie use list_state. Params: criteriaWeights?, matrixId?. Returns {options, count, ranked}.",
  paramsSchema: ListOptionsSchema,
  handler: async (params) => listOptions(ws().weightedOptions ?? [], params),
  mcpHandler: async (params, ctx) =>
    listOptions(await serverListEntities<WeightedOption>(ctx.userId, WEIGHTED_OPTION_KIND), params),
});

/** The option to write: the stored one with the new name and scores, everything else kept. */
function optionToWrite(
  stored: WeightedOption | undefined,
  o: z.infer<typeof WeightedOptionInputSchema>
): WeightedOption {
  const next = mergeOption(stored, {
    id: o.id ?? genId(),
    name: o.name.slice(0, OPTION_NAME_MAX),
    scores: o.scores,
  });
  // A new option goes where it's asked to (default: the default matrix); an
  // existing one stays in its matrix unless moved explicitly. The default
  // matrix's rows carry no matrixId, as the legacy rows do.
  if (o.matrixId === DEFAULT_WEIGHTED_MATRIX_ID) delete next.matrixId;
  else if (o.matrixId) next.matrixId = o.matrixId;
  return next;
}

/**
 * The matrixIds among `list` that name no matrix (neither a stored one nor
 * the default): an option written there would sit in no matrix the page
 * or list_state shows, so the write is refused instead.
 */
async function unknownMatrices(
  store: WeightedStore,
  list: readonly { matrixId?: string }[]
): Promise<string[]> {
  const asked = Array.from(new Set(list.flatMap((o) => (o.matrixId ? [o.matrixId] : []))));
  const known = await Promise.all(asked.map((id) => knownMatrix(store, id)));
  return asked.filter((_, i) => known[i] === null);
}

async function persistOne(store: WeightedStore, p: z.infer<typeof WeightedOptionInputSchema>) {
  const unknown = await unknownMatrices(store, [p]);
  if (unknown.length > 0)
    return { persisted: false, reason: "matrix_not_found", matrixId: p.matrixId };
  const stored = p.id ? (await store.options()).find((x) => x.id === p.id) : undefined;
  const option = optionToWrite(stored, p);
  await store.putOption(option);
  return { id: option.id, offScale: offScaleScores(option.scores) };
}

registry.register({
  id: "tool.weighted_decision.score_and_persist_option",
  toolId: "tool.weighted_decision",
  name: "score_and_persist_option",
  category: "write",
  description:
    "Persist a WeightedOption's name and raw per-criterion scores (replacing its scores). Every other stored field is kept (its matrix, its note); matrixId? places a new option (default: the default matrix) or moves an existing one, and must name an existing matrix. No total is stored: totals are worked out from the criteria on read. Scores off the 1–10 scale are stored but flagged and don't count. Returns {id, offScale: criterionIds} or {persisted: false, reason: 'matrix_not_found', matrixId} (nothing written).",
  paramsSchema: WeightedOptionInputSchema,
  handler: async (params) => persistOne(browserStore, params),
  mcpHandler: async (params, ctx) => {
    const unknown = await unknownMatrices(serverStore(ctx.userId), [params]);
    if (unknown.length > 0) {
      return { persisted: false, reason: "matrix_not_found", matrixId: params.matrixId };
    }
    const stored = params.id
      ? await serverGetEntity<WeightedOption>(ctx.userId, WEIGHTED_OPTION_KIND, params.id)
      : null;
    const option = optionToWrite(stored ?? undefined, params);
    await serverUpsertEntity<WeightedOption>(ctx.userId, WEIGHTED_OPTION_KIND, option);
    return { id: option.id, offScale: offScaleScores(option.scores) };
  },
});

async function persistMany(
  store: WeightedStore,
  list: z.infer<typeof WeightedOptionInputSchema>[]
) {
  // All or nothing: one unknown matrix refuses the batch, so no option of it lands nowhere.
  const unknown = await unknownMatrices(store, list);
  if (unknown.length > 0) {
    return {
      written: [],
      count: 0,
      persisted: false,
      reason: "matrix_not_found",
      matrixIds: unknown,
    };
  }
  const byId = new Map((await store.options()).map((o) => [o.id, o]));
  const options = list.map((o) => optionToWrite(o.id ? byId.get(o.id) : undefined, o));
  await store.putOptions(options);
  return {
    written: options.map((o) => o.id),
    count: options.length,
    offScale: Object.fromEntries(
      options
        .filter((o) => offScaleScores(o.scores).length > 0)
        .map((o) => [o.id, offScaleScores(o.scores)])
    ),
  };
}

registry.register({
  id: "tool.weighted_decision.persist_options",
  toolId: "tool.weighted_decision",
  name: "persist_options",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of WeightedOption rows (upsert by id; items without an id get one). Each keeps every stored field besides its name and scores (its matrix, its note); a matrixId must name an existing matrix. Does not clear the collection. Returns {written: ids, count, offScale: {optionId: criterionIds}} (off-scale scores are stored but don't count), or {written: [], count: 0, persisted: false, reason: 'matrix_not_found', matrixIds} when any matrixId is unknown (nothing written).",
  paramsSchema: z.object({
    options: z.array(WeightedOptionInputSchema).min(1).max(500),
  }),
  handler: async (params) => persistMany(browserStore, params.options),
  mcpHandler: async (params, ctx) => persistMany(serverStore(ctx.userId), params.options),
});
