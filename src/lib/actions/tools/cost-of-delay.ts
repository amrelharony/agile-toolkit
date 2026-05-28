/**
 * Cost-of-Delay (CD3) — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     Reinertsen's CD3 = Cost-of-Delay ÷ Job Size.
 *           UI collects per-week dollars + weeks delayed; the action set
 *           extends that with `jobSize` so the canonical CD3 formula can
 *           run end-to-end. When `jobSize` is omitted on a compute call
 *           we fall back to 1 (effectively "raw cost of delay" — equal
 *           to what the in-app form shows on its KPI strip).
 *
 * Agent surface: tool.cost_of_delay.*  (snake_case per registry naming)
 * Backing CRUD : workspace.prioritization.* (shared with wsjf/rice/ice/…)
 * framework    : "cost-of-delay" — see PrioritizationItem union in
 *                workspace-types.ts.
 *
 * Mirrors src/lib/actions/tools/wsjf.ts beat-for-beat (the squad-13
 * canonical pattern). Five actions: 3 reads (pure compute, batch+rank,
 * list_scored) and 2 writes (compute+persist one, bulk-upsert pre-scored).
 *
 * Formula is inlined here rather than added to scoring-rubric.ts because
 * the rubric module is S0-protected; CoD is short enough that an inline
 * helper carries no maintenance cost. Job size is floored at 0.5 to
 * defuse divide-by-zero (matches wsjfScore semantics).
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity, serverBulkUpsertEntities } from "../server-store";
import { rank } from "@/lib/analytics/scoring-rubric";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

const KIND_PRIORITIZATION = "workspace:prioritization";
const FRAMEWORK = "cost-of-delay" as const;

function nowIso(): string {
  return new Date().toISOString();
}

/** Coerce to a finite number; NaN/Infinity/null fall back to 0. */
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * CD3 = cost-of-delay ÷ job size.
 *
 * `costOfDelay` is precomputed by the caller from per-week × weeks, OR
 * supplied directly as a single number when the agent already knows the
 * total $-impact of a delay. `jobSize` is floored at 0.5 so a user
 * entering 0 ("guessing later") still produces a finite score instead
 * of Infinity. All components are clamped to ≥ 0 to refuse negative
 * inputs.
 */
function cd3Score(costOfDelay: number, jobSize: number): number {
  const size = Math.max(0.5, num(jobSize, 0.5));
  return Math.max(0, num(costOfDelay)) / size;
}

/** Shared input shape for one CD3 candidate.
 *
 *  Matches what the cost-of-delay client form collects (`perWeekUsd`,
 *  `weeksDelayed`) and adds `jobSize` (story points / weeks of effort)
 *  to complete the canonical CD3 ratio. Cost-of-delay is derived as
 *  `perWeekUsd * weeksDelayed`. */
const CostOfDelayFieldsSchema = z.object({
  perWeekUsd: z
    .number()
    .min(0)
    .describe("Estimated revenue / cost impact per week of delay, in USD (≥ 0)"),
  weeksDelayed: z
    .number()
    .min(0)
    .describe("Number of weeks the initiative is (or would be) delayed (≥ 0)"),
  jobSize: z
    .number()
    .min(0)
    .default(1)
    .describe(
      "Job size in story points or weeks of effort (≥ 0; floored at 0.5). Defaults to 1 so the score equals the raw total cost of delay when size is unknown."
    ),
});

const CostOfDelayItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: CostOfDelayFieldsSchema,
});

// ──────── tool.cost_of_delay.compute_cd3 ────────
// Pure: compute one CD3 score. No persistence, no side effects.
registry.register({
  id: "tool.cost_of_delay.compute_cd3",
  toolId: "tool.cost_of_delay",
  name: "compute_cd3",
  category: "read",
  description:
    "Compute the CD3 score (perWeekUsd × weeksDelayed) ÷ jobSize for a single initiative. Pure — no persistence. jobSize defaults to 1 (raw cost-of-delay) when omitted.",
  paramsSchema: CostOfDelayFieldsSchema,
  handler: async (params) => {
    const costOfDelay = Math.max(0, num(params.perWeekUsd)) * Math.max(0, num(params.weeksDelayed));
    // zod's `.default(1)` only applies when the schema is parsed; direct
    // handler invocation (test path, in-process composition) skips parse
    // so we normalise here too. `?? 1` (not `|| 1`) so an intentional 0
    // still hits cd3Score where it's floored at 0.5.
    const jobSize = params.jobSize ?? 1;
    const score = cd3Score(costOfDelay, jobSize);
    return {
      score,
      costOfDelay,
      formula: "(perWeekUsd * weeksDelayed) / jobSize",
    };
  },
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.cost_of_delay.compute_and_rank ────────
// Pure batch: compute + dense-rank a list of candidates.
registry.register({
  id: "tool.cost_of_delay.compute_and_rank",
  toolId: "tool.cost_of_delay",
  name: "compute_and_rank",
  category: "read",
  description:
    "Score a batch of initiatives by CD3 and return them ranked descending. Ties get the same rank (dense rank) so 'top decile' exports are stable.",
  paramsSchema: z.object({
    items: z.array(CostOfDelayItemInputSchema).min(1).max(500),
  }),
  handler: async (params) => {
    const scored = params.items.map((it) => {
      const costOfDelay =
        Math.max(0, num(it.fields.perWeekUsd)) * Math.max(0, num(it.fields.weeksDelayed));
      const jobSize = it.fields.jobSize ?? 1;
      return {
        id: it.id ?? `cd3_${Math.random().toString(36).slice(2, 10)}`,
        title: it.title,
        fields: it.fields,
        score: cd3Score(costOfDelay, jobSize),
      };
    });
    const ranked = rank(scored);
    return { ranked, count: ranked.length };
  },
});

// ──────── tool.cost_of_delay.list_scored ────────
// Read-only snapshot of cost-of-delay items currently in the workspace.
registry.register({
  id: "tool.cost_of_delay.list_scored",
  toolId: "tool.cost_of_delay",
  name: "list_scored",
  category: "read",
  description:
    "List all prioritization items in the workspace scored by cost-of-delay, ranked descending. Filtered to framework='cost-of-delay' so other frameworks (WSJF, RICE…) don't leak through.",
  paramsSchema: z.object({}),
  handler: async () => {
    const all = useWorkspaceStore.getState().prioritizations ?? [];
    const items = all.filter((x) => x.framework === FRAMEWORK);
    const ranked = rank(
      items.map((x) => ({
        id: x.id,
        title: x.title,
        fields: x.fields ?? {},
        score: x.score ?? 0,
      }))
    );
    return { items: ranked, count: ranked.length };
  },
  mcpHandler: async (_params, ctx) => {
    const all = await serverListEntities<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION);
    const items = all.filter((x) => x.framework === FRAMEWORK);
    const ranked = rank(
      items.map((x) => ({
        id: x.id,
        title: x.title,
        fields: x.fields ?? {},
        score: x.score ?? 0,
      }))
    );
    return { items: ranked, count: ranked.length };
  },
});

// ──────── tool.cost_of_delay.score_and_persist ────────
// Convenience: compute one CD3 score AND save it to the workspace.
// Common agent intent: "score this initiative and add it to my CoD tracker."
registry.register({
  id: "tool.cost_of_delay.score_and_persist",
  toolId: "tool.cost_of_delay",
  name: "score_and_persist",
  category: "write",
  description:
    "Compute a CD3 score for one initiative and persist it to workspace.prioritization with framework='cost-of-delay'. Returns the saved item's id and score.",
  paramsSchema: CostOfDelayItemInputSchema,
  handler: async (params) => {
    const costOfDelay =
      Math.max(0, num(params.fields.perWeekUsd)) * Math.max(0, num(params.fields.weeksDelayed));
    const jobSize = params.fields.jobSize ?? 1;
    const score = cd3Score(costOfDelay, jobSize);
    const item: PrioritizationItem = {
      id: params.id ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
      framework: FRAMEWORK,
      title: params.title.slice(0, 200),
      score,
      // Preserve totalCost alongside the raw inputs — the in-app form
      // writes it on every add, so keeping it here means rows added via
      // the agent surface display identically in the existing table.
      fields: { ...params.fields, jobSize, totalCost: costOfDelay },
      status: "scored",
      updatedAt: nowIso(),
    };
    useWorkspaceStore.getState().upsertPrioritization(item);
    return { id: item.id, score };
  },
  mcpHandler: async (params, ctx) => {
    const costOfDelay =
      Math.max(0, num(params.fields.perWeekUsd)) * Math.max(0, num(params.fields.weeksDelayed));
    const jobSize = params.fields.jobSize ?? 1;
    const score = cd3Score(costOfDelay, jobSize);
    const item: PrioritizationItem = {
      id: params.id ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
      framework: FRAMEWORK,
      title: params.title.slice(0, 200),
      score,
      fields: { ...params.fields, jobSize, totalCost: costOfDelay },
      status: "scored",
      updatedAt: nowIso(),
    };
    await serverUpsertEntity<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, item);
    return { id: item.id, score };
  },
});

// ──────── tool.cost_of_delay.persist_to_prioritization ────────
// Bulk write of pre-scored items (typically the output of compute_and_rank).
// Destructive in the sense that it overwrites items with matching ids,
// but additive at the workspace level — does NOT clear existing CoD
// items. requiresConfirmation:false because each upsert is idempotent
// and the agent is expected to compose this after a compute_and_rank step.
registry.register({
  id: "tool.cost_of_delay.persist_to_prioritization",
  toolId: "tool.cost_of_delay",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of pre-scored cost-of-delay items to workspace.prioritization. Items without an id get one generated. Items with an existing id are overwritten (upsert by id).",
  paramsSchema: z.object({
    items: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string().min(1).max(200),
          score: z.number().describe("Pre-computed CD3 score from compute_and_rank"),
          fields: CostOfDelayFieldsSchema,
        })
      )
      .min(1)
      .max(500),
  }),
  handler: async (params) => {
    const upsert = useWorkspaceStore.getState().upsertPrioritization;
    const written: string[] = [];
    const now = nowIso();
    for (const it of params.items) {
      const totalCost =
        Math.max(0, num(it.fields.perWeekUsd)) * Math.max(0, num(it.fields.weeksDelayed));
      const jobSize = it.fields.jobSize ?? 1;
      const item: PrioritizationItem = {
        id: it.id ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
        framework: FRAMEWORK,
        title: it.title.slice(0, 200),
        score: it.score,
        fields: { ...it.fields, jobSize, totalCost },
        status: "scored",
        updatedAt: now,
      };
      upsert(item);
      written.push(item.id);
    }
    return { written, count: written.length };
  },
  mcpHandler: async (params, ctx) => {
    const now = nowIso();
    const items: PrioritizationItem[] = params.items.map((it) => {
      const totalCost =
        Math.max(0, num(it.fields.perWeekUsd)) * Math.max(0, num(it.fields.weeksDelayed));
      const jobSize = it.fields.jobSize ?? 1;
      return {
        id: it.id ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
        framework: FRAMEWORK,
        title: it.title.slice(0, 200),
        score: it.score,
        fields: { ...it.fields, jobSize, totalCost },
        status: "scored",
        updatedAt: now,
      };
    });
    // Single round-trip for the batch — much faster than N individual
    // upserts when the agent is loading a backlog of 50+ items.
    await serverBulkUpsertEntities<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, items);
    return { written: items.map((i) => i.id), count: items.length };
  },
});
