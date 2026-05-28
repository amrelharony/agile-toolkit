/**
 * WSJF (Weighted Shortest Job First) — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     SAFe's (Business Value + Time Criticality + RR/OE) ÷ Job Size
 *
 * Agent surface: tool.wsjf.*
 * Backing CRUD : workspace.prioritization.* (auto-generated, shared with
 *                ice-score, rice, moscow, eisenhower, kano-model,
 *                cost-of-delay, weighted-decision)
 *
 * ─── CANONICAL REFERENCE for all calculator-style tools ──────────────
 * This file is the squad-13 reference pattern. Every prioritization
 * calculator (ICE, RICE, MoSCoW, Eisenhower, Kano, etc.) follows the
 * same shape:
 *
 *   1. compute_score          — pure: one item in, one score out
 *   2. compute_and_rank       — pure: array in, ranked array out
 *   3. list_scored            — read existing items of THIS framework
 *   4. persist_to_prioritization  — write scored items to workspace
 *   5. score_and_persist      — convenience: compute one + persist
 *
 * Why compute is "read" not "write": compute_score is referentially
 * transparent — same inputs, same output, no side effects. Agents can
 * call it during planning ("what would my WSJF look like with these
 * tweaks?") without needing the workspace to mutate. persist_* is the
 * write that materialises chosen results.
 *
 * Why framework filtering: workspace.prioritization holds items from
 * ALL frameworks (WSJF, RICE, ICE, MoSCoW…) in one table. Reading via
 * tool.wsjf.list_scored applies the framework="wsjf" filter so an
 * agent asking about WSJF doesn't see RICE noise.
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity, serverBulkUpsertEntities } from "../server-store";
import { wsjfScore, rank } from "@/lib/analytics/scoring-rubric";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

const KIND_PRIORITIZATION = "workspace:prioritization";
const FRAMEWORK = "wsjf" as const;

function nowIso(): string {
  return new Date().toISOString();
}

/** Shared input shape for one WSJF candidate. All four scoring inputs
 *  are non-negative; jobSize is floored at 0.5 to defuse div-by-zero
 *  (the in-app form does the same — see wsjf-client.tsx:46). */
const WsjfFieldsSchema = z.object({
  businessValue: z.number().min(0).describe("Estimated business value, typically 1-13 (Fibonacci)"),
  timeCriticality: z.number().min(0).describe("Time criticality / cost of delay, typically 1-13"),
  rrOe: z.number().min(0).describe("Risk Reduction / Opportunity Enablement, typically 1-13"),
  jobSize: z
    .number()
    .min(0)
    .describe("Job size in story points or weeks, typically 1-13 (floored at 0.5)"),
});

const WsjfItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: WsjfFieldsSchema,
});

// ──────── tool.wsjf.compute_score ────────
// Pure: compute one WSJF score. No persistence, no side effects.
registry.register({
  id: "tool.wsjf.compute_score",
  toolId: "tool.wsjf",
  name: "compute_score",
  category: "read",
  description:
    "Compute the WSJF score (Business Value + Time Criticality + RR/OE) ÷ Job Size for a single candidate. Pure — no persistence.",
  paramsSchema: WsjfFieldsSchema,
  handler: async (params) => {
    const score = wsjfScore(
      params.businessValue,
      params.timeCriticality,
      params.rrOe,
      params.jobSize
    );
    return { score, formula: "(BV + TC + RR/OE) / size" };
  },
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.wsjf.compute_and_rank ────────
// Pure batch: compute + dense-rank a list of candidates.
registry.register({
  id: "tool.wsjf.compute_and_rank",
  toolId: "tool.wsjf",
  name: "compute_and_rank",
  category: "read",
  description:
    "Score a batch of candidates by WSJF and return them ranked descending. Ties get the same rank (dense rank) so 'top decile' exports are stable.",
  paramsSchema: z.object({
    items: z.array(WsjfItemInputSchema).min(1).max(500),
  }),
  handler: async (params) => {
    const scored = params.items.map((it) => ({
      id: it.id ?? `wsjf_${Math.random().toString(36).slice(2, 10)}`,
      title: it.title,
      fields: it.fields,
      score: wsjfScore(
        it.fields.businessValue,
        it.fields.timeCriticality,
        it.fields.rrOe,
        it.fields.jobSize
      ),
    }));
    const ranked = rank(scored);
    return { ranked, count: ranked.length };
  },
});

// ──────── tool.wsjf.list_scored ────────
// Read-only snapshot of WSJF items currently in the workspace.
registry.register({
  id: "tool.wsjf.list_scored",
  toolId: "tool.wsjf",
  name: "list_scored",
  category: "read",
  description:
    "List all prioritization items in the workspace scored by WSJF, ranked descending. Filtered to framework='wsjf' so other frameworks (RICE, ICE…) don't leak through.",
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

// ──────── tool.wsjf.score_and_persist ────────
// Convenience: compute one WSJF score AND save it to the workspace.
// Common agent intent: "score this feature and add it to my backlog."
registry.register({
  id: "tool.wsjf.score_and_persist",
  toolId: "tool.wsjf",
  name: "score_and_persist",
  category: "write",
  description:
    "Compute a WSJF score for one candidate and persist it to workspace.prioritization with framework='wsjf'. Returns the saved item's id and score.",
  paramsSchema: WsjfItemInputSchema,
  handler: async (params) => {
    const score = wsjfScore(
      params.fields.businessValue,
      params.fields.timeCriticality,
      params.fields.rrOe,
      params.fields.jobSize
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
    const score = wsjfScore(
      params.fields.businessValue,
      params.fields.timeCriticality,
      params.fields.rrOe,
      params.fields.jobSize
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

// ──────── tool.wsjf.persist_to_prioritization ────────
// Bulk write of pre-scored items (typically the output of compute_and_rank).
// Destructive in the sense that it overwrites items with matching ids,
// but additive at the workspace level — does NOT clear existing WSJF
// items. requiresConfirmation:false because each item upsert is
// idempotent and the agent is expected to compose this after a
// compute_and_rank step.
registry.register({
  id: "tool.wsjf.persist_to_prioritization",
  toolId: "tool.wsjf",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of pre-scored WSJF items to workspace.prioritization. Items without an id get one generated. Items with an existing id are overwritten (upsert by id).",
  paramsSchema: z.object({
    items: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string().min(1).max(200),
          score: z.number().describe("Pre-computed WSJF score from compute_and_rank"),
          fields: WsjfFieldsSchema,
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
