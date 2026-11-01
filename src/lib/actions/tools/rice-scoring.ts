/**
 * RICE Scoring — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     Reach × Impact × Confidence ÷ Effort (Intercom's RICE)
 *
 * Agent surface: tool.rice_scoring.*
 * Backing CRUD : workspace.prioritization.* (auto-generated, shared with
 *                wsjf, ice-score, moscow, eisenhower, kano-model,
 *                cost-of-delay, weighted-decision)
 *
 * Follows the squad-13 canonical pattern locked in by tool.wsjf.* — same
 * five-action shape, same "compute is read / persist is write" split,
 * same framework-filter on list_scored.
 *
 * The score is the method registry's (lib/prioritization/methods/rice), the
 * code the page uses:
 * - reach counts per `reachPeriod` (week, month, quarter or year) and is
 *   normalised to per quarter, so periods compare. A persist that leaves
 *   the period out keeps the row's (or its linked item's), as the page's
 *   editor prefills it; a new row without one, and a pure compute, count
 *   per quarter;
 * - confidencePct is a PERCENTAGE 0..100, not a 0..1 fraction;
 * - effort is person-months, at least 0.5. A persist refuses less (as the
 *   form does); compute reports a legacy 0 < effort < 0.5 scored as 0.5
 *   with a warning, and an effort of 0 as Not scored (`score: null`).
 * Persist verbs recompute the score (a caller's `score` is ignored), keep
 * an existing row's link, and with `backlogItemId` link the row and write
 * its inputs through to that backlog item, as the page does.
 */

import { z } from "zod";
import { registry } from "../registry";
import { method } from "@/lib/prioritization/methods";
import { LEGACY_REACH_PERIOD, REACH_PERIODS } from "@/lib/prioritization/methods/rice";
import type { Values } from "@/lib/prioritization/methods";
import {
  candidateId,
  clientStore,
  listMethodRows,
  persistMethodRows,
  rankCandidates,
  serverStore,
  type MethodStore,
} from "./_method-rows";

const FRAMEWORK = "rice" as const;
const RICE = method(FRAMEWORK);

/** Shared input shape for one RICE candidate. The schema says the ranges;
 *  a persist also refuses an effort under 0.5, as the form does. */
const RiceFieldsSchema = z.object({
  reach: z
    .number()
    .min(0)
    .describe("People/accounts reached per reachPeriod (default per quarter)"),
  reachPeriod: z
    .enum(REACH_PERIODS)
    .optional()
    .describe(
      "The period reach counts over: week, month, quarter or year. The score normalises reach to per quarter (week ×13, month ×3, year ÷4). Left out: a persist keeps the existing row's period (a linked row's is its backlog item's; a new row linked to an item takes the item's), and a new row or a compute counts per quarter."
    ),
  impact: z
    .number()
    .min(0)
    .describe(
      "Per-person impact: 3 massive, 2 high, 1 medium, 0.5 low, 0.25 minimal (exact value kept)"
    ),
  confidencePct: z
    .number()
    .min(0)
    .max(100)
    .describe(
      "Confidence as a percentage 0-100 (NOT 0-1): 100 backed by data, 80 some evidence, 50 mostly a guess; under 50 is a moonshot to test first"
    ),
  effort: z
    .number()
    .min(0)
    .describe(
      "Effort in person-months, 0.5 at least (persist refuses less; 0 is Not scored, never floored)"
    ),
});

type RiceFields = z.infer<typeof RiceFieldsSchema>;

const RiceItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: RiceFieldsSchema,
  backlogItemId: z
    .string()
    .optional()
    .describe(
      "Link the row to this backlog item (tool.prioritizer.list_state ids); its RICE inputs are written to the item"
    ),
});

/**
 * The API's fields as the method's inputs. A period left out stays unset:
 * a compute reads that as per quarter, and a persist keeps the row's.
 */
const valuesOf = (f: RiceFields): Values => ({
  reach: f.reach,
  reachPeriod: f.reachPeriod,
  impact: f.impact,
  confidence: f.confidencePct,
  effort: f.effort,
});

/**
 * A persist that leaves the period out keeps the row's (a linked row's is
 * its item's; a new linked row takes the item's), as the page's editor
 * prefills it. Only a new unlinked row starts per quarter.
 */
const PERSIST = { keep: ["reachPeriod"], fallback: { reachPeriod: LEGACY_REACH_PERIOD } };

const FORMULA = "(Reach per quarter * Impact * Confidence%) / Effort";

// ──────── tool.rice_scoring.compute_score ────────
// Pure: compute one RICE score. No persistence, no side effects.
registry.register({
  id: "tool.rice_scoring.compute_score",
  toolId: "tool.rice_scoring",
  name: "compute_score",
  category: "read",
  description:
    "Compute the RICE score (Reach per quarter × Impact × Confidence%) ÷ Effort for a single candidate, as the RICE page scores it. Confidence is a percentage 0-100, not a 0-1 fraction; reach is normalised from its reachPeriod to per quarter. Returns {score, formula, reachPerQuarter, missing, warnings}: score is null (Not scored) for an effort of 0; an effort under 0.5 counts as 0.5 with a warning. Pure — no persistence.",
  paramsSchema: RiceFieldsSchema,
  handler: async (params) => {
    const r = RICE.evaluate(valuesOf(params));
    return {
      score: r.score,
      formula: FORMULA,
      reachPerQuarter: r.extra?.reachPerQuarter ?? null,
      missing: r.missing,
      warnings: r.warnings,
    };
  },
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.rice_scoring.compute_and_rank ────────
// Pure batch: compute + dense-rank a list of candidates.
registry.register({
  id: "tool.rice_scoring.compute_and_rank",
  toolId: "tool.rice_scoring",
  name: "compute_and_rank",
  category: "read",
  description:
    "Score a batch of candidates by RICE and return them ranked descending. Ties get the same rank (dense rank) so 'top decile' exports are stable; a candidate that can't be scored (effort 0) has score null and comes last.",
  paramsSchema: z.object({
    items: z.array(RiceItemInputSchema).min(1).max(500),
  }),
  handler: async (params) => {
    const ranked = rankCandidates(
      FRAMEWORK,
      params.items.map((it) => ({
        id: it.id ?? candidateId("rice"),
        title: it.title,
        fields: it.fields,
        values: valuesOf(it.fields),
      }))
    );
    return { ranked, count: ranked.length };
  },
});

// ──────── tool.rice_scoring.list_scored ────────
// Read-only snapshot of RICE items currently in the workspace.
const listScored = async (store: MethodStore) => {
  const items = await listMethodRows(store, FRAMEWORK);
  return { items, count: items.length };
};

registry.register({
  id: "tool.rice_scoring.list_scored",
  toolId: "tool.rice_scoring",
  name: "list_scored",
  category: "read",
  description:
    "List all prioritization items in the workspace scored by RICE, ranked descending, with the page's numbers: a row linked to a backlog item reads its inputs from that item. Each item: {id, title, fields, values, score, rank, percentile, missing, warnings, backlogItemId, live, extra: {reachPerQuarter}}; a row missing an input has score null and comes last. Filtered to framework='rice' so other frameworks (WSJF, ICE…) don't leak through.",
  paramsSchema: z.object({}),
  handler: async () => listScored(clientStore()),
  mcpHandler: async (_params, ctx) => listScored(serverStore(ctx.userId)),
});

// ──────── tool.rice_scoring.score_and_persist ────────
// Convenience: compute one RICE score AND save it to the workspace.
// Common agent intent: "score this initiative and add it to my backlog."
const scoreAndPersist = async (store: MethodStore, params: z.infer<typeof RiceItemInputSchema>) => {
  const [saved] = await persistMethodRows(
    store,
    FRAMEWORK,
    [
      {
        id: params.id,
        title: params.title,
        values: valuesOf(params.fields),
        backlogItemId: params.backlogItemId,
      },
    ],
    PERSIST
  );
  return {
    id: saved.row.id,
    score: saved.score,
    backlogItemId: saved.backlogItemId,
    backlogUpdated: saved.backlogUpdated,
  };
};

registry.register({
  id: "tool.rice_scoring.score_and_persist",
  toolId: "tool.rice_scoring",
  name: "score_and_persist",
  category: "write",
  description:
    "Compute a RICE score for one candidate and persist it to workspace.prioritization with framework='rice' (an effort under 0.5 person-months is refused). An existing id keeps its other fields, its reachPeriod when none is given, and its backlog link. backlogItemId links the row and writes its inputs to that backlog item. Returns {id, score, backlogItemId, backlogUpdated}.",
  paramsSchema: RiceItemInputSchema,
  handler: async (params) => scoreAndPersist(clientStore(), params),
  mcpHandler: async (params, ctx) => scoreAndPersist(serverStore(ctx.userId), params),
});

// ──────── tool.rice_scoring.persist_to_prioritization ────────
// Bulk write of candidates (typically the output of compute_and_rank).
// Destructive in the sense that it overwrites items with matching ids,
// but additive at the workspace level — does NOT clear existing RICE
// items. requiresConfirmation:false because each item upsert is
// idempotent and the agent is expected to compose this after a
// compute_and_rank step.
const PersistSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1).max(200),
        score: z
          .number()
          .optional()
          .describe("Ignored: the score is recomputed from the fields, as the page does"),
        fields: RiceFieldsSchema,
        backlogItemId: z.string().optional().describe("Link the row to this backlog item"),
      })
    )
    .min(1)
    .max(500),
});

const persistAll = async (store: MethodStore, params: z.infer<typeof PersistSchema>) => {
  const saved = await persistMethodRows(
    store,
    FRAMEWORK,
    params.items.map((it) => ({
      id: it.id,
      title: it.title,
      values: valuesOf(it.fields),
      backlogItemId: it.backlogItemId,
    })),
    PERSIST
  );
  return {
    written: saved.map((s) => s.row.id),
    count: saved.length,
    scores: saved.map((s) => ({ id: s.row.id, score: s.score })),
  };
};

registry.register({
  id: "tool.rice_scoring.persist_to_prioritization",
  toolId: "tool.rice_scoring",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of RICE items to workspace.prioritization. Each score is recomputed from its fields (a supplied score is ignored); an effort under 0.5 is refused and nothing is written. Items without an id get one generated; an existing id is updated in place, keeping its other fields, its reachPeriod when none is given, and its backlog link. Returns {written, count, scores}.",
  paramsSchema: PersistSchema,
  handler: async (params) => persistAll(clientStore(), params),
  mcpHandler: async (params, ctx) => persistAll(serverStore(ctx.userId), params),
});
