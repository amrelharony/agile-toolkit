/**
 * Cost of Delay (CD3) — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     Reinertsen's CD3 = cost of delay per week ÷ duration in weeks,
 *           ordered by urgency profile.
 *
 * Agent surface: tool.cost_of_delay.*  (snake_case per registry naming)
 * Backing CRUD : workspace.prioritization.* (shared with wsjf/rice/ice/…)
 * framework    : "cost-of-delay" — see PrioritizationItem union in
 *                workspace-types.ts.
 *
 * Mirrors src/lib/actions/tools/wsjf.ts beat-for-beat (the squad-13
 * canonical pattern). Five actions: 3 reads (pure compute, batch+rank,
 * list_scored) and 2 writes (compute+persist one, bulk-upsert).
 *
 * The score is the method registry's (lib/prioritization/methods/
 * cost-of-delay), the code the page uses:
 * - CD3 = perWeekUsd ÷ durationWeeks, the duration at least half a week;
 *   no duration is Not scored (`score: null`), never a default;
 * - the urgency profile (expedite | fixed_date | standard | intangible)
 *   orders the lanes: expedite first, then fixed date by latest start
 *   (the date it must land by less its duration), then standard by CD3,
 *   then intangible by CD3; a row with no profile yet comes after standard;
 * - `jobSize` is a deprecated alias of `durationWeeks` for one release;
 *   `weeksDelayed` is the old model's input, kept on the row for
 *   reference and never part of the score.
 */

import { z } from "zod";
import { registry } from "../registry";
import { method, type Values } from "@/lib/prioritization/methods";
import { COD_URGENCIES } from "@/lib/prioritization/methods/cost-of-delay";
import {
  candidateId,
  clientStore,
  listMethodRows,
  persistMethodRows,
  rankCandidates,
  serverStore,
  type MethodStore,
} from "./_method-rows";

const FRAMEWORK = "cost-of-delay" as const;
const COD = method(FRAMEWORK);

/** Shared input shape for one CD3 candidate. */
const CostOfDelayFieldsSchema = z.object({
  perWeekUsd: z
    .number()
    .min(0)
    .describe("What a week of waiting costs, in USD (revenue lost, cost incurred) (≥ 0)"),
  durationWeeks: z
    .number()
    .positive()
    .optional()
    .describe("How long the work takes, in weeks (half a week at least). Without it: Not scored."),
  urgency: z
    .enum(COD_URGENCIES)
    .optional()
    .describe(
      "Urgency profile: 'expedite' (do now), 'fixed_date' (cost jumps on a date; give fixedDate), 'standard' (cost grows steadily) or 'intangible' (little cost now). Orders the lanes."
    ),
  fixedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "For 'fixed_date': the YYYY-MM-DD it must land by. latestStart = this date − the duration."
    ),
  weeksDelayed: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Deprecated (the old total-cost model): kept on the row for reference, not part of CD3"
    ),
  jobSize: z
    .number()
    .min(0)
    .optional()
    .describe("Deprecated alias of durationWeeks, used only when durationWeeks is absent"),
});

type CodFields = z.infer<typeof CostOfDelayFieldsSchema>;

const CostOfDelayItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: CostOfDelayFieldsSchema,
  backlogItemId: z
    .string()
    .optional()
    .describe(
      "Link the row to this backlog item, so the Prioritizer's Cost of Delay column shows it"
    ),
});

/** The API's fields as the method's inputs (jobSize standing in for a missing duration). */
const valuesOf = (f: CodFields): Values => ({
  perWeekUsd: f.perWeekUsd,
  durationWeeks:
    f.durationWeeks ?? (f.jobSize !== undefined && f.jobSize > 0 ? f.jobSize : undefined),
  urgency: f.urgency,
  fixedDate: f.fixedDate,
});

/** The old total (per week × weeks delayed), when the caller still gives weeksDelayed. */
const legacyTotal = (f: CodFields): number | null =>
  f.weeksDelayed === undefined ? null : Math.max(0, f.perWeekUsd) * Math.max(0, f.weeksDelayed);

/** Agents that called before the urgency profile existed may leave it out. */
const MAY_OMIT = ["urgency"];

// ──────── tool.cost_of_delay.compute_cd3 ────────
// Pure: compute one CD3 score. No persistence, no side effects.
registry.register({
  id: "tool.cost_of_delay.compute_cd3",
  toolId: "tool.cost_of_delay",
  name: "compute_cd3",
  category: "read",
  description:
    "Compute CD3 = perWeekUsd ÷ durationWeeks (the duration at least half a week) for a single initiative, as the Cost of Delay page does. Returns { score (null without a duration: Not scored), lane (the urgency profile), latestStart (fixed date − duration), costOfDelay (deprecated: perWeekUsd × weeksDelayed when given, else null), formula, missing, warnings }. Pure — no persistence.",
  paramsSchema: CostOfDelayFieldsSchema,
  handler: async (params) => {
    const r = COD.evaluate(valuesOf(params));
    return {
      score: r.score,
      lane: r.bucket,
      latestStart: r.extra?.latestStart ?? null,
      costOfDelay: legacyTotal(params),
      formula: "perWeekUsd / durationWeeks",
      missing: r.missing,
      warnings: r.warnings,
    };
  },
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.cost_of_delay.compute_and_rank ────────
// Pure batch: compute + rank a list of candidates by lane, then CD3.
registry.register({
  id: "tool.cost_of_delay.compute_and_rank",
  toolId: "tool.cost_of_delay",
  name: "compute_and_rank",
  category: "read",
  description:
    "Score a batch of initiatives by CD3 and return them in the page's order: expedite first, then fixed date by latest start, then standard by CD3, then intangible by CD3 (a row with no profile comes after standard). Ties share a rank (dense rank); an initiative without a duration has score null and comes last.",
  paramsSchema: z.object({
    items: z.array(CostOfDelayItemInputSchema).min(1).max(500),
  }),
  handler: async (params) => {
    const ranked = rankCandidates(
      FRAMEWORK,
      params.items.map((it) => ({
        id: it.id ?? candidateId("cod"),
        title: it.title,
        fields: it.fields,
        values: valuesOf(it.fields),
      }))
    );
    return { ranked, count: ranked.length };
  },
});

// ──────── tool.cost_of_delay.list_scored ────────
// Read-only snapshot of CoD items currently in the workspace.
const listScored = async (store: MethodStore) => {
  const items = await listMethodRows(store, FRAMEWORK);
  return { items, count: items.length };
};

registry.register({
  id: "tool.cost_of_delay.list_scored",
  toolId: "tool.cost_of_delay",
  name: "list_scored",
  category: "read",
  description:
    "List all prioritization items in the workspace scored by Cost of Delay, in the page's lane order, with the page's numbers. Each item: {id, title, fields, values, score (CD3, or null: a row from before CD3 has no duration and reads 'Not scored: add a duration'), rank, bucket (the lane), missing, warnings, extra: {latestStart, totalCost (the old total, kept for reference)}}. Filtered to framework='cost-of-delay'.",
  paramsSchema: z.object({}),
  handler: async () => listScored(clientStore()),
  mcpHandler: async (_params, ctx) => listScored(serverStore(ctx.userId)),
});

// ──────── tool.cost_of_delay.score_and_persist ────────
// Convenience: compute one CD3 score AND save it to the workspace.
const persistInput = (it: {
  id?: string;
  title: string;
  fields: CodFields;
  backlogItemId?: string;
}) => {
  // The old model's weeksDelayed stays on the row for reference (never scored).
  const values: Values = { ...valuesOf(it.fields), weeksDelayed: it.fields.weeksDelayed };
  return { id: it.id, title: it.title, values, backlogItemId: it.backlogItemId };
};

const scoreAndPersist = async (
  store: MethodStore,
  params: z.infer<typeof CostOfDelayItemInputSchema>
) => {
  const [saved] = await persistMethodRows(store, FRAMEWORK, [persistInput(params)], {
    mayOmit: MAY_OMIT,
  });
  return {
    id: saved.row.id,
    score: saved.score,
    lane: saved.bucket,
    backlogItemId: saved.backlogItemId,
  };
};

registry.register({
  id: "tool.cost_of_delay.score_and_persist",
  toolId: "tool.cost_of_delay",
  name: "score_and_persist",
  category: "write",
  description:
    "Compute a CD3 score for one initiative and persist it to workspace.prioritization with framework='cost-of-delay' (a duration under half a week, or a fixed_date profile without its date, is refused). An existing id keeps its other fields and its backlog link. Returns { id, score, lane, backlogItemId }.",
  paramsSchema: CostOfDelayItemInputSchema,
  handler: async (params) => scoreAndPersist(clientStore(), params),
  mcpHandler: async (params, ctx) => scoreAndPersist(serverStore(ctx.userId), params),
});

// ──────── tool.cost_of_delay.persist_to_prioritization ────────
// Bulk write of candidates (typically the output of compute_and_rank).
// requiresConfirmation:false because each upsert is idempotent by id.
const PersistSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1).max(200),
        score: z
          .number()
          .optional()
          .describe("Ignored: CD3 is recomputed from the fields, as the page does"),
        fields: CostOfDelayFieldsSchema,
        backlogItemId: z.string().optional().describe("Link the row to this backlog item"),
      })
    )
    .min(1)
    .max(500),
});

const persistAll = async (store: MethodStore, params: z.infer<typeof PersistSchema>) => {
  const saved = await persistMethodRows(store, FRAMEWORK, params.items.map(persistInput), {
    mayOmit: MAY_OMIT,
  });
  return {
    written: saved.map((s) => s.row.id),
    count: saved.length,
    scores: saved.map((s) => ({ id: s.row.id, score: s.score, lane: s.bucket })),
  };
};

registry.register({
  id: "tool.cost_of_delay.persist_to_prioritization",
  toolId: "tool.cost_of_delay",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of Cost of Delay items to workspace.prioritization. CD3 is recomputed from the fields (a supplied score is ignored); an invalid item is refused and nothing is written. Items without an id get one generated; an existing id is updated in place, keeping its other fields and backlog link. Returns {written, count, scores}.",
  paramsSchema: PersistSchema,
  handler: async (params) => persistAll(clientStore(), params),
  mcpHandler: async (params, ctx) => persistAll(serverStore(ctx.userId), params),
});
