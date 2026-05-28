/**
 * ICE (Impact × Confidence × Ease) — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     Lightweight Impact * Confidence * Ease scoring (each 1-10),
 *           score range 1..1000. Best for fast prioritisation of growth
 *           experiments and quick wins.
 *
 * Agent surface: tool.ice_score.*
 * Backing CRUD : workspace.prioritization.* (auto-generated, shared with
 *                wsjf, rice, moscow, eisenhower, kano-model,
 *                cost-of-delay, weighted-decision)
 *
 * Mirrors the squad-13 canonical pattern in tools/wsjf.ts. See that file
 * for the full rationale on:
 *   - compute_* being category=read (referentially transparent)
 *   - list_scored applying a framework filter so frameworks don't bleed
 *   - mcpHandler vs handler split for write actions
 *
 * Why the id segment is `ice_score` and not `ice-score`: Anthropic tool
 * names must match ^[a-zA-Z0-9_-]+$ AND the registry munges dots to
 * underscores. A hyphen in the second segment would render fine on the
 * MCP side but parses oddly in the agent's tool name, so we normalise
 * to snake_case here while the route id ("ice-score") stays kebab.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity, serverBulkUpsertEntities } from "../server-store";
import { iceScore, rank } from "@/lib/analytics/scoring-rubric";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

const KIND_PRIORITIZATION = "workspace:prioritization";
const FRAMEWORK = "ice" as const;

function nowIso(): string {
  return new Date().toISOString();
}

/** Shared input shape for one ICE candidate. Each input is documented
 *  as 1..10 (the iceScore helper clamps anyway, but the schema makes the
 *  intended range explicit to agents reading the tool description). */
const IceFieldsSchema = z.object({
  impact: z
    .number()
    .min(1)
    .max(10)
    .describe("Expected impact, 1-10 (clamped). Higher = bigger user/business win."),
  confidence: z
    .number()
    .min(1)
    .max(10)
    .describe("Confidence the impact estimate is right, 1-10 (clamped)."),
  ease: z
    .number()
    .min(1)
    .max(10)
    .describe("Ease of execution, 1-10 (clamped). Higher = cheaper to ship."),
});

const IceItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: IceFieldsSchema,
});

// ──────── tool.ice_score.compute_score ────────
// Pure: compute one ICE score. No persistence, no side effects.
registry.register({
  id: "tool.ice_score.compute_score",
  toolId: "tool.ice_score",
  name: "compute_score",
  category: "read",
  description:
    "Compute the ICE score (Impact * Confidence * Ease, each clamped 1-10, range 1..1000) for a single candidate. Pure — no persistence.",
  paramsSchema: IceFieldsSchema,
  handler: async (params) => {
    const score = iceScore(params.impact, params.confidence, params.ease);
    return { score, formula: "Impact * Confidence * Ease" };
  },
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.ice_score.compute_and_rank ────────
// Pure batch: compute + dense-rank a list of candidates.
registry.register({
  id: "tool.ice_score.compute_and_rank",
  toolId: "tool.ice_score",
  name: "compute_and_rank",
  category: "read",
  description:
    "Score a batch of candidates by ICE and return them ranked descending. Ties get the same rank (dense rank) so 'top decile' exports are stable.",
  paramsSchema: z.object({
    items: z.array(IceItemInputSchema).min(1).max(500),
  }),
  handler: async (params) => {
    const scored = params.items.map((it) => ({
      id: it.id ?? `ice_${Math.random().toString(36).slice(2, 10)}`,
      title: it.title,
      fields: it.fields,
      score: iceScore(it.fields.impact, it.fields.confidence, it.fields.ease),
    }));
    const ranked = rank(scored);
    return { ranked, count: ranked.length };
  },
});

// ──────── tool.ice_score.list_scored ────────
// Read-only snapshot of ICE items currently in the workspace.
registry.register({
  id: "tool.ice_score.list_scored",
  toolId: "tool.ice_score",
  name: "list_scored",
  category: "read",
  description:
    "List all prioritization items in the workspace scored by ICE, ranked descending. Filtered to framework='ice' so other frameworks (RICE, WSJF…) don't leak through.",
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

// ──────── tool.ice_score.score_and_persist ────────
// Convenience: compute one ICE score AND save it to the workspace.
// Common agent intent: "score this experiment and add it to my backlog."
registry.register({
  id: "tool.ice_score.score_and_persist",
  toolId: "tool.ice_score",
  name: "score_and_persist",
  category: "write",
  description:
    "Compute an ICE score for one candidate and persist it to workspace.prioritization with framework='ice'. Returns the saved item's id and score.",
  paramsSchema: IceItemInputSchema,
  handler: async (params) => {
    const score = iceScore(params.fields.impact, params.fields.confidence, params.fields.ease);
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
    const score = iceScore(params.fields.impact, params.fields.confidence, params.fields.ease);
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

// ──────── tool.ice_score.persist_to_prioritization ────────
// Bulk write of pre-scored items (typically the output of compute_and_rank).
// Destructive in the sense that it overwrites items with matching ids,
// but additive at the workspace level — does NOT clear existing ICE
// items. requiresConfirmation:false because each item upsert is
// idempotent and the agent is expected to compose this after a
// compute_and_rank step.
registry.register({
  id: "tool.ice_score.persist_to_prioritization",
  toolId: "tool.ice_score",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of pre-scored ICE items to workspace.prioritization. Items without an id get one generated. Items with an existing id are overwritten (upsert by id).",
  paramsSchema: z.object({
    items: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string().min(1).max(200),
          score: z.number().describe("Pre-computed ICE score from compute_and_rank"),
          fields: IceFieldsSchema,
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
