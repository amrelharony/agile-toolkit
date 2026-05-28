/**
 * Weighted Decision Matrix (Pugh / MCDA) — tool-local actions.
 *
 * Category: Decision Frameworks (squad S13, wave 2 CRUD-backed)
 * Tool:     Score each option against weighted criteria; total =
 *           Σ score(criterion) × weight(criterion). Best for choosing
 *           between similar competitors (vendor selection, tech
 *           options, etc).
 *
 * Agent surface: tool.weighted_decision.*
 * Backing CRUD : workspace.weighted_option.* (see ../workspace/index.ts).
 *
 * ─── DESIGN: storage vs. compute split ──────────────────────────────
 * Unlike WSJF / CD3 / RICE, this framework's storage holds ONLY raw
 * per-criterion scores per option (`{cost: 8, speed: 6, quality: 9}`).
 * The criterion *weights* live elsewhere — they belong to the decision
 * *context*, not the option:
 *
 *   - In the UI, weights are stored as `WeightedCriterion[]` against the
 *     workspace; the same option could be re-scored against different
 *     rubrics (e.g. "what if we cared 3x more about cost?").
 *   - For the agent, weights are *supplied at query time*. Callers pass
 *     `criteriaWeights: Record<string, number>` on every compute /
 *     list_options call.
 *
 * That's why neither score nor weights are persisted with the option:
 * persisting them would tie the option to a single rubric and undercut
 * the framework's main move (multi-rubric exploration).
 *
 * Five actions:
 *   1. compute_option_score  — pure: scores for one option, weights → total
 *   2. compute_and_rank      — pure: array of options + weights → ranked
 *   3. list_options          — read existing options; if weights given,
 *                              attach scores + rank, else raw
 *   4. score_and_persist_option — write one WeightedOption (raw scores)
 *   5. persist_options       — bulk write WeightedOption[] (raw scores)
 *
 * Why no derived `score` field on persisted items: see above — the
 * score is rubric-dependent and would be stale the moment weights
 * change. Callers compute on read.
 * ────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity, serverBulkUpsertEntities } from "../server-store";
import { weightedScore, rank } from "@/lib/analytics/scoring-rubric";
import type { WeightedOption } from "@/lib/stores/workspace-types";

const KIND_WEIGHTED_OPTION = "workspace:weightedOption";

/** Per-criterion raw scores: `{ criterionId: rawScore }`. Numeric, the
 *  agent picks the scale (often 1-5 or 1-10) — we don't clamp because
 *  Pugh matrices sometimes use signed scores (-1 / 0 / +1 vs. baseline). */
const ScoresMapSchema = z
  .record(z.string(), z.number())
  .describe("Per-criterion raw scores keyed by criterionId, e.g. {cost: 8, speed: 6}");

/** Per-criterion weights: `{ criterionId: weight }`. The Pugh/MCDA
 *  convention is sum=1.0 (or sum=100) but we don't normalise — that
 *  would silently change the resulting totals if the rubric is
 *  unbalanced. The in-app form surfaces a warning when weights drift
 *  past ±5% of either convention; agents can do the same client-side. */
const WeightsMapSchema = z
  .record(z.string(), z.number())
  .describe(
    "Per-criterion weights keyed by criterionId, e.g. {cost: 0.5, speed: 0.3, quality: 0.2}. Pugh/MCDA convention is sum=1.0 (or sum=100) but values aren't auto-normalised."
  );

/** Shape of one weighted option as the agent supplies it (id optional). */
const WeightedOptionInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  name: z.string().min(1).max(200),
  scores: ScoresMapSchema,
});

function genId(): string {
  return `weightedOpt_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Rank a list of `{id, name, score}` items by `score` descending and
 * attach `rank` + `percentile`. The shared `rank()` helper requires a
 * `title` field, but WeightedOption canonically uses `name` — we pass
 * `name` through `title` so the rank() helper works, then re-key on
 * the way out so the agent sees a consistent `{id, name, scores,
 * score, rank, percentile}` shape.
 */
function rankWeighted<S extends Record<string, number>>(
  items: Array<{ id: string; name: string; scores: S; score: number }>
): Array<{ id: string; name: string; scores: S; score: number; rank: number; percentile: number }> {
  const intoRanker = items.map((it) => ({
    id: it.id,
    title: it.name, // satisfy ScoredItem<T>.title
    fields: it.scores,
    score: it.score,
  }));
  const ranked = rank(intoRanker);
  return ranked.map((r) => ({
    id: r.id,
    name: r.title,
    scores: r.fields,
    score: r.score,
    rank: r.rank,
    percentile: r.percentile,
  }));
}

// ──────── tool.weighted_decision.compute_option_score ────────
// Pure: total weighted score for ONE option.
// Returns `{score}`. No persistence, no side effects, no ranking —
// agents compose this with their own logic when sweeping rubrics
// ("what does this option score under three different weight schemes?").
registry.register({
  id: "tool.weighted_decision.compute_option_score",
  toolId: "tool.weighted_decision",
  name: "compute_option_score",
  category: "read",
  description:
    "Compute Σ score(criterion) × weight(criterion) for a single option. Pure — no persistence. Pass per-criterion raw scores and the rubric's weights; missing criteria contribute 0.",
  paramsSchema: z.object({
    optionScores: ScoresMapSchema,
    criteriaWeights: WeightsMapSchema,
  }),
  handler: async (params) => {
    const score = weightedScore(params.optionScores, params.criteriaWeights);
    return { score, formula: "Σ score(c) × weight(c)" };
  },
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.weighted_decision.compute_and_rank ────────
// Pure batch: given a list of options + shared weights, return them
// ranked descending with rank + percentile attached.
registry.register({
  id: "tool.weighted_decision.compute_and_rank",
  toolId: "tool.weighted_decision",
  name: "compute_and_rank",
  category: "read",
  description:
    "Score a batch of options against a shared weight rubric and return them ranked descending. Ties get the same dense rank so 'top option' picks are stable across re-runs with identical inputs.",
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
    const ranked = rankWeighted(scored);
    return { ranked, count: ranked.length };
  },
});

// ──────── tool.weighted_decision.list_options ────────
// Read all WeightedOption rows in the workspace. Criteria weights are
// rubric-specific and don't live with the options — pass them in to get
// a ranked, scored result; omit them to get the raw options as stored.
registry.register({
  id: "tool.weighted_decision.list_options",
  toolId: "tool.weighted_decision",
  name: "list_options",
  category: "read",
  description:
    "List all WeightedOption rows in the workspace. If criteriaWeights is supplied, options come back scored + ranked; otherwise they come back raw (per-criterion scores only). Weights are not persisted with options because they belong to the decision rubric, not the option.",
  paramsSchema: z.object({
    criteriaWeights: WeightsMapSchema.optional(),
  }),
  handler: async (params) => {
    const all = useWorkspaceStore.getState().weightedOptions ?? [];
    if (!params.criteriaWeights) {
      return { options: all, count: all.length, ranked: false as const };
    }
    const weights = params.criteriaWeights;
    const scored = all.map((o) => ({
      id: o.id,
      name: o.name,
      scores: o.scores,
      score: weightedScore(o.scores, weights),
    }));
    const ranked = rankWeighted(scored);
    return { options: ranked, count: ranked.length, ranked: true as const };
  },
  mcpHandler: async (params, ctx) => {
    const all = await serverListEntities<WeightedOption>(ctx.userId, KIND_WEIGHTED_OPTION);
    if (!params.criteriaWeights) {
      return { options: all, count: all.length, ranked: false as const };
    }
    const weights = params.criteriaWeights;
    const scored = all.map((o) => ({
      id: o.id,
      name: o.name,
      scores: o.scores,
      score: weightedScore(o.scores, weights),
    }));
    const ranked = rankWeighted(scored);
    return { options: ranked, count: ranked.length, ranked: true as const };
  },
});

// ──────── tool.weighted_decision.score_and_persist_option ────────
// Persist one WeightedOption (raw per-criterion scores only). Despite
// the name's "score_" prefix — kept for surface-consistency with the
// rest of the squad-13 calc tools — no weighted total is computed here:
// see the file header for why weights aren't persisted with options.
// Use compute_option_score before persisting if you need the total.
registry.register({
  id: "tool.weighted_decision.score_and_persist_option",
  toolId: "tool.weighted_decision",
  name: "score_and_persist_option",
  category: "write",
  description:
    "Persist a WeightedOption (name + per-criterion raw scores) to workspace.weighted_option. Returns the saved option's id. Note: no weighted total is computed or stored — totals are recomputed from current criteria weights on read.",
  paramsSchema: WeightedOptionInputSchema,
  handler: async (params) => {
    const option: WeightedOption = {
      id: params.id ?? genId(),
      name: params.name.slice(0, 200),
      scores: { ...params.scores },
    };
    useWorkspaceStore.getState().upsertWeightedOption(option);
    return { id: option.id };
  },
  mcpHandler: async (params, ctx) => {
    const option: WeightedOption = {
      id: params.id ?? genId(),
      name: params.name.slice(0, 200),
      scores: { ...params.scores },
    };
    await serverUpsertEntity<WeightedOption>(ctx.userId, KIND_WEIGHTED_OPTION, option);
    return { id: option.id };
  },
});

// ──────── tool.weighted_decision.persist_options ────────
// Bulk write of WeightedOption[]. Mirrors persist_to_prioritization on
// the calc-tool side but writes to workspace.weighted_option instead.
// Idempotent per-id (existing options are overwritten); does NOT clear
// the slice — only the items in the payload are touched.
registry.register({
  id: "tool.weighted_decision.persist_options",
  toolId: "tool.weighted_decision",
  name: "persist_options",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of WeightedOption rows to workspace.weighted_option. Items without an id get one generated. Items with an existing id are overwritten (upsert by id). Does not clear the existing collection — only the items in the payload are touched.",
  paramsSchema: z.object({
    options: z.array(WeightedOptionInputSchema).min(1).max(500),
  }),
  handler: async (params) => {
    const upsert = useWorkspaceStore.getState().upsertWeightedOption;
    const written: string[] = [];
    for (const o of params.options) {
      const option: WeightedOption = {
        id: o.id ?? genId(),
        name: o.name.slice(0, 200),
        scores: { ...o.scores },
      };
      upsert(option);
      written.push(option.id);
    }
    return { written, count: written.length };
  },
  mcpHandler: async (params, ctx) => {
    const options: WeightedOption[] = params.options.map((o) => ({
      id: o.id ?? genId(),
      name: o.name.slice(0, 200),
      scores: { ...o.scores },
    }));
    // Single round-trip for the batch — much faster than N individual
    // upserts when seeding a fresh rubric with many candidates.
    await serverBulkUpsertEntities<WeightedOption>(ctx.userId, KIND_WEIGHTED_OPTION, options);
    return { written: options.map((o) => o.id), count: options.length };
  },
});
