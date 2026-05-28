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
 * same framework-filter on list_scored. Only the formula and framework
 * tag differ. See src/lib/actions/tools/wsjf.ts for the rationale on
 * each design choice.
 *
 * Formula note: confidencePct here is a PERCENTAGE in 0..100 (the form
 * shows "Confidence 0-100%"), not a 0..1 fraction. The shared
 * `riceScore` helper does the /100 conversion internally and clamps
 * effort at 0.5 to defuse div-by-zero on typos.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity, serverBulkUpsertEntities } from "../server-store";
import { riceScore, rank } from "@/lib/analytics/scoring-rubric";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

const KIND_PRIORITIZATION = "workspace:prioritization";
const FRAMEWORK = "rice" as const;

function nowIso(): string {
  return new Date().toISOString();
}

/** Shared input shape for one RICE candidate. All four inputs are
 *  non-negative; the shared helper clamps confidence to [0, 100] and
 *  floors effort at 0.5 anyway, but we mirror those bounds in the
 *  schema so agents get clear validation errors instead of silent
 *  clamping when they pass garbage. */
const RiceFieldsSchema = z.object({
  reach: z.number().min(0).describe("People/accounts reached per period (e.g. per quarter)"),
  impact: z.number().min(0).describe("Per-user impact, typically 0.25 (minimal) to 3.0 (massive)"),
  confidencePct: z
    .number()
    .min(0)
    .max(100)
    .describe("Confidence in the estimate as a percentage 0-100 (NOT 0-1)"),
  effort: z
    .number()
    .min(0)
    .describe("Effort in person-months, floored at 0.5 to defuse div-by-zero"),
});

const RiceItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: RiceFieldsSchema,
});

// ──────── tool.rice_scoring.compute_score ────────
// Pure: compute one RICE score. No persistence, no side effects.
registry.register({
  id: "tool.rice_scoring.compute_score",
  toolId: "tool.rice_scoring",
  name: "compute_score",
  category: "read",
  description:
    "Compute the RICE score (Reach × Impact × Confidence%) ÷ Effort for a single candidate. Confidence is a percentage 0-100, not a 0-1 fraction. Pure — no persistence.",
  paramsSchema: RiceFieldsSchema,
  handler: async (params) => {
    const score = riceScore(params.reach, params.impact, params.confidencePct, params.effort);
    return { score, formula: "(Reach * Impact * Confidence%) / Effort" };
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
    "Score a batch of candidates by RICE and return them ranked descending. Ties get the same rank (dense rank) so 'top decile' exports are stable.",
  paramsSchema: z.object({
    items: z.array(RiceItemInputSchema).min(1).max(500),
  }),
  handler: async (params) => {
    const scored = params.items.map((it) => ({
      id: it.id ?? `rice_${Math.random().toString(36).slice(2, 10)}`,
      title: it.title,
      fields: it.fields,
      score: riceScore(
        it.fields.reach,
        it.fields.impact,
        it.fields.confidencePct,
        it.fields.effort
      ),
    }));
    const ranked = rank(scored);
    return { ranked, count: ranked.length };
  },
});

// ──────── tool.rice_scoring.list_scored ────────
// Read-only snapshot of RICE items currently in the workspace.
registry.register({
  id: "tool.rice_scoring.list_scored",
  toolId: "tool.rice_scoring",
  name: "list_scored",
  category: "read",
  description:
    "List all prioritization items in the workspace scored by RICE, ranked descending. Filtered to framework='rice' so other frameworks (WSJF, ICE…) don't leak through.",
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

// ──────── tool.rice_scoring.score_and_persist ────────
// Convenience: compute one RICE score AND save it to the workspace.
// Common agent intent: "score this initiative and add it to my backlog."
registry.register({
  id: "tool.rice_scoring.score_and_persist",
  toolId: "tool.rice_scoring",
  name: "score_and_persist",
  category: "write",
  description:
    "Compute a RICE score for one candidate and persist it to workspace.prioritization with framework='rice'. Returns the saved item's id and score.",
  paramsSchema: RiceItemInputSchema,
  handler: async (params) => {
    const score = riceScore(
      params.fields.reach,
      params.fields.impact,
      params.fields.confidencePct,
      params.fields.effort
    );
    const item: PrioritizationItem = {
      id: params.id ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
      framework: FRAMEWORK,
      title: params.title.slice(0, 200),
      score,
      fields: { ...params.fields },
      status: "scored",
      updatedAt: nowIso(),
    };
    useWorkspaceStore.getState().upsertPrioritization(item);
    return { id: item.id, score };
  },
  mcpHandler: async (params, ctx) => {
    const score = riceScore(
      params.fields.reach,
      params.fields.impact,
      params.fields.confidencePct,
      params.fields.effort
    );
    const item: PrioritizationItem = {
      id: params.id ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
      framework: FRAMEWORK,
      title: params.title.slice(0, 200),
      score,
      fields: { ...params.fields },
      status: "scored",
      updatedAt: nowIso(),
    };
    await serverUpsertEntity<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, item);
    return { id: item.id, score };
  },
});

// ──────── tool.rice_scoring.persist_to_prioritization ────────
// Bulk write of pre-scored items (typically the output of compute_and_rank).
// Destructive in the sense that it overwrites items with matching ids,
// but additive at the workspace level — does NOT clear existing RICE
// items. requiresConfirmation:false because each item upsert is
// idempotent and the agent is expected to compose this after a
// compute_and_rank step.
registry.register({
  id: "tool.rice_scoring.persist_to_prioritization",
  toolId: "tool.rice_scoring",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of pre-scored RICE items to workspace.prioritization. Items without an id get one generated. Items with an existing id are overwritten (upsert by id).",
  paramsSchema: z.object({
    items: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string().min(1).max(200),
          score: z.number().describe("Pre-computed RICE score from compute_and_rank"),
          fields: RiceFieldsSchema,
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
      const item: PrioritizationItem = {
        id: it.id ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
        framework: FRAMEWORK,
        title: it.title.slice(0, 200),
        score: it.score,
        fields: { ...it.fields },
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
    const items: PrioritizationItem[] = params.items.map((it) => ({
      id: it.id ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
      framework: FRAMEWORK,
      title: it.title.slice(0, 200),
      score: it.score,
      fields: { ...it.fields },
      status: "scored",
      updatedAt: now,
    }));
    // Single round-trip for the batch — much faster than N individual
    // upserts when the agent is loading a backlog of 50+ items.
    await serverBulkUpsertEntities<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, items);
    return { written: items.map((i) => i.id), count: items.length };
  },
});
