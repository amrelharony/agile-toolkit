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
 *
 * The score is the method registry's (lib/prioritization/methods/ice), the
 * code the page uses. The backlog holds no ICE inputs, so `backlogItemId`
 * only links the row: the Prioritizer's ICE column then shows its score.
 */

import { z } from "zod";
import { registry } from "../registry";
import { method, type Values } from "@/lib/prioritization/methods";
import {
  candidateId,
  clientStore,
  listMethodRows,
  persistMethodRows,
  rankCandidates,
  serverStore,
  type MethodStore,
} from "./_method-rows";

const FRAMEWORK = "ice" as const;
const ICE = method(FRAMEWORK);

/** Shared input shape for one ICE candidate, each 1..10 (the page's scales). */
const IceFieldsSchema = z.object({
  impact: z
    .number()
    .min(1)
    .max(10)
    .describe(
      "Expected impact, 1-10: 1 barely noticeable, 5 a clear improvement, 10 changes the game for the goal."
    ),
  confidence: z
    .number()
    .min(1)
    .max(10)
    .describe(
      "Confidence the estimates are right, 1-10: 1 a hunch, 5 data points or interviews, 10 proven in an earlier launch."
    ),
  ease: z
    .number()
    .min(1)
    .max(10)
    .describe(
      "Ease of execution, 1-10: 1 months across teams, 5 two to three weeks, 10 under a day."
    ),
});

type IceFields = z.infer<typeof IceFieldsSchema>;

const IceItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: IceFieldsSchema,
  backlogItemId: z
    .string()
    .optional()
    .describe(
      "Link the row to this backlog item (tool.prioritizer.list_state ids), so the Prioritizer's ICE column shows it"
    ),
});

const valuesOf = (f: IceFields): Values => ({ ...f });

// ──────── tool.ice_score.compute_score ────────
// Pure: compute one ICE score. No persistence, no side effects.
registry.register({
  id: "tool.ice_score.compute_score",
  toolId: "tool.ice_score",
  name: "compute_score",
  category: "read",
  description:
    "Compute the ICE score (Impact * Confidence * Ease, each 1-10, range 1..1000) for a single candidate, as the ICE page scores it. Returns {score, formula}. Pure — no persistence.",
  paramsSchema: IceFieldsSchema,
  handler: async (params) => {
    const r = ICE.evaluate(valuesOf(params));
    return { score: r.score, formula: "Impact * Confidence * Ease", missing: r.missing };
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
    const ranked = rankCandidates(
      FRAMEWORK,
      params.items.map((it) => ({
        id: it.id ?? candidateId("ice"),
        title: it.title,
        fields: it.fields,
        values: valuesOf(it.fields),
      }))
    );
    return { ranked, count: ranked.length };
  },
});

// ──────── tool.ice_score.list_scored ────────
// Read-only snapshot of ICE items currently in the workspace.
const listScored = async (store: MethodStore) => {
  const items = await listMethodRows(store, FRAMEWORK);
  return { items, count: items.length };
};

registry.register({
  id: "tool.ice_score.list_scored",
  toolId: "tool.ice_score",
  name: "list_scored",
  category: "read",
  description:
    "List all prioritization items in the workspace scored by ICE, ranked descending, with the page's numbers. Each item: {id, title, fields, values, score, rank, percentile, missing, backlogItemId}; a row missing a score input has score null (Not scored) and comes last. Filtered to framework='ice' so other frameworks (RICE, WSJF…) don't leak through.",
  paramsSchema: z.object({}),
  handler: async () => listScored(clientStore()),
  mcpHandler: async (_params, ctx) => listScored(serverStore(ctx.userId)),
});

// ──────── tool.ice_score.score_and_persist ────────
// Convenience: compute one ICE score AND save it to the workspace.
// Common agent intent: "score this experiment and add it to my backlog."
const scoreAndPersist = async (store: MethodStore, params: z.infer<typeof IceItemInputSchema>) => {
  const [saved] = await persistMethodRows(store, FRAMEWORK, [
    {
      id: params.id,
      title: params.title,
      values: valuesOf(params.fields),
      backlogItemId: params.backlogItemId,
    },
  ]);
  return { id: saved.row.id, score: saved.score, backlogItemId: saved.backlogItemId };
};

registry.register({
  id: "tool.ice_score.score_and_persist",
  toolId: "tool.ice_score",
  name: "score_and_persist",
  category: "write",
  description:
    "Compute an ICE score for one candidate and persist it to workspace.prioritization with framework='ice'. An existing id keeps its other fields and its backlog link; backlogItemId links it to a backlog item. Returns {id, score, backlogItemId}.",
  paramsSchema: IceItemInputSchema,
  handler: async (params) => scoreAndPersist(clientStore(), params),
  mcpHandler: async (params, ctx) => scoreAndPersist(serverStore(ctx.userId), params),
});

// ──────── tool.ice_score.persist_to_prioritization ────────
// Bulk write of candidates (typically the output of compute_and_rank).
// Destructive in the sense that it overwrites items with matching ids,
// but additive at the workspace level — does NOT clear existing ICE
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
        fields: IceFieldsSchema,
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
    }))
  );
  return {
    written: saved.map((s) => s.row.id),
    count: saved.length,
    scores: saved.map((s) => ({ id: s.row.id, score: s.score })),
  };
};

registry.register({
  id: "tool.ice_score.persist_to_prioritization",
  toolId: "tool.ice_score",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of ICE items to workspace.prioritization. Each score is recomputed from its fields (a supplied score is ignored). Items without an id get one generated; an existing id is updated in place, keeping its other fields and backlog link. Returns {written, count, scores}.",
  paramsSchema: PersistSchema,
  handler: async (params) => persistAll(clientStore(), params),
  mcpHandler: async (params, ctx) => persistAll(serverStore(ctx.userId), params),
});
