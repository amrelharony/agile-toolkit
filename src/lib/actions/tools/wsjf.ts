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
 *
 * Every score is the method registry's (lib/prioritization/methods), the
 * code the pages use; the shared plumbing (read-through lists, checked
 * persists, the write-through to a linked backlog item) is ./_method-rows.
 * ─────────────────────────────────────────────────────────────────────
 *
 * WSJF scale: every part is on the modified Fibonacci scale 1, 2, 3, 5, 8,
 * 13, 20, relative to the other items (give the smallest a 1); nothing
 * clamps to 10. Job size divides at least by 1; a job size of 0 is Not
 * scored (`score: null`). A persist checks like the form: each part a step
 * of the scale (a value the row already holds may stay, as the form's
 * Custom) and a job size of at least 1.
 */

import { z } from "zod";
import { registry } from "../registry";
import { method, type Values } from "@/lib/prioritization/methods";
import { columnsWithoutOne } from "@/lib/prioritization/methods/wsjf";
import {
  candidateId,
  clientStore,
  listMethodRows,
  persistMethodRows,
  rankCandidates,
  serverStore,
  type MethodStore,
} from "./_method-rows";

const FRAMEWORK = "wsjf" as const;
const WSJF = method(FRAMEWORK);

const FIB =
  "modified Fibonacci 1, 2, 3, 5, 8, 13, 20, relative to the other items (give the smallest a 1)";

/** Shared input shape for one WSJF candidate. A pure compute scores any
 *  number (job size divides at least by 1); a persist checks the scale
 *  like the form: each part a step, or the value the row already holds. */
const WsjfFieldsSchema = z.object({
  businessValue: z.number().min(0).describe(`User-business value, ${FIB}`),
  timeCriticality: z.number().min(0).describe(`Time criticality, ${FIB}`),
  rrOe: z.number().min(0).describe(`Risk Reduction / Opportunity Enablement, ${FIB}`),
  jobSize: z
    .number()
    .min(0)
    .describe(
      `Job size, ${FIB}. Divides at least by 1; 0 is Not scored. A persist refuses a part off the scale (unless the row already holds it) and a job size below 1`
    ),
});

type WsjfFields = z.infer<typeof WsjfFieldsSchema>;

const WsjfItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: WsjfFieldsSchema,
  backlogItemId: z
    .string()
    .optional()
    .describe(
      "Link the row to this backlog item (tool.prioritizer.list_state ids); its WSJF parts are written to the item"
    ),
});

const valuesOf = (f: WsjfFields): Values => ({ ...f });

// ──────── tool.wsjf.compute_score ────────
// Pure: compute one WSJF score. No persistence, no side effects.
registry.register({
  id: "tool.wsjf.compute_score",
  toolId: "tool.wsjf",
  name: "compute_score",
  category: "read",
  description:
    "Compute the WSJF score (Business Value + Time Criticality + RR/OE) ÷ Job Size for a single candidate, as the WSJF page and the Prioritizer score it. Parts are on the modified Fibonacci scale 1-20; job size divides at least by 1. Returns {score, formula, missing, warnings}: score is null (Not scored) for a job size of 0. Pure — no persistence.",
  paramsSchema: WsjfFieldsSchema,
  handler: async (params) => {
    const r = WSJF.evaluate(valuesOf(params));
    return {
      score: r.score,
      formula: "(BV + TC + RR/OE) / max(1, size)",
      missing: r.missing,
      warnings: r.warnings,
    };
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
    "Score a batch of candidates by WSJF and return them ranked descending. Ties get the same rank (dense rank) so 'top decile' exports are stable; a candidate with a job size of 0 has score null and comes last. Also returns columnsWithoutOne: the parts where no candidate has a 1 (score relatively: give the smallest a 1).",
  paramsSchema: z.object({
    items: z.array(WsjfItemInputSchema).min(1).max(500),
  }),
  handler: async (params) => {
    const ranked = rankCandidates(
      FRAMEWORK,
      params.items.map((it) => ({
        id: it.id ?? candidateId("wsjf"),
        title: it.title,
        fields: it.fields,
        values: valuesOf(it.fields),
      }))
    );
    return {
      ranked,
      count: ranked.length,
      columnsWithoutOne: columnsWithoutOne(params.items.map((it) => valuesOf(it.fields))),
    };
  },
});

// ──────── tool.wsjf.list_scored ────────
// Read-only snapshot of WSJF items currently in the workspace.
const listScored = async (store: MethodStore) => {
  const items = await listMethodRows(store, FRAMEWORK);
  return {
    items,
    count: items.length,
    columnsWithoutOne: columnsWithoutOne(items.map((i) => i.values)),
  };
};

registry.register({
  id: "tool.wsjf.list_scored",
  toolId: "tool.wsjf",
  name: "list_scored",
  category: "read",
  description:
    "List all prioritization items in the workspace scored by WSJF, ranked descending, with the page's numbers: a row linked to a backlog item reads its parts from that item. Each item: {id, title, fields, values, score, rank, percentile, missing, warnings, backlogItemId, live}; a title-only row (or one missing a part) has score null and comes last. Also returns columnsWithoutOne (parts where no item has a 1). Filtered to framework='wsjf' so other frameworks (RICE, ICE…) don't leak through.",
  paramsSchema: z.object({}),
  handler: async () => listScored(clientStore()),
  mcpHandler: async (_params, ctx) => listScored(serverStore(ctx.userId)),
});

// ──────── tool.wsjf.score_and_persist ────────
// Convenience: compute one WSJF score AND save it to the workspace.
// Common agent intent: "score this feature and add it to my backlog."
const scoreAndPersist = async (store: MethodStore, params: z.infer<typeof WsjfItemInputSchema>) => {
  const [saved] = await persistMethodRows(store, FRAMEWORK, [
    {
      id: params.id,
      title: params.title,
      values: valuesOf(params.fields),
      backlogItemId: params.backlogItemId,
    },
  ]);
  return {
    id: saved.row.id,
    score: saved.score,
    backlogItemId: saved.backlogItemId,
    backlogUpdated: saved.backlogUpdated,
  };
};

registry.register({
  id: "tool.wsjf.score_and_persist",
  toolId: "tool.wsjf",
  name: "score_and_persist",
  category: "write",
  description:
    "Compute a WSJF score for one candidate and persist it to workspace.prioritization with framework='wsjf' (a part off the 1, 2, 3, 5, 8, 13, 20 scale is refused unless the row already holds it, and so is a job size below 1). An existing id keeps its other fields and its backlog link. backlogItemId links the row and writes its parts to that backlog item (rrOe is the item's riskReduction). Returns {id, score, backlogItemId, backlogUpdated}.",
  paramsSchema: WsjfItemInputSchema,
  handler: async (params) => scoreAndPersist(clientStore(), params),
  mcpHandler: async (params, ctx) => scoreAndPersist(serverStore(ctx.userId), params),
});

// ──────── tool.wsjf.persist_to_prioritization ────────
// Bulk write of candidates (typically the output of compute_and_rank).
// Destructive in the sense that it overwrites items with matching ids,
// but additive at the workspace level — does NOT clear existing WSJF
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
        fields: WsjfFieldsSchema,
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
  id: "tool.wsjf.persist_to_prioritization",
  toolId: "tool.wsjf",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of WSJF items to workspace.prioritization. Each score is recomputed from its fields (a supplied score is ignored); a part off the scale (unless the row already holds it) or a job size below 1 is refused and nothing is written. Items without an id get one generated; an existing id is updated in place, keeping its other fields and backlog link. Returns {written, count, scores}.",
  paramsSchema: PersistSchema,
  handler: async (params) => persistAll(clientStore(), params),
  mcpHandler: async (params, ctx) => persistAll(serverStore(ctx.userId), params),
});
