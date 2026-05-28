/**
 * Value vs Effort Matrix — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     2x2 quadrant — Value (y-axis) × Effort (x-axis)
 *
 * Agent surface: tool.value_effort_matrix.*
 * Backing CRUD : workspace.prioritization.* (auto-generated, shared with
 *                wsjf, rice, ice, moscow, eisenhower, kano-model, etc.)
 *
 * Unlike the calculator-style frameworks (WSJF / RICE / ICE) this tool
 * doesn't compute a continuous score from weighted inputs — it
 * classifies each item into one of four quadrants based on whether
 * value and effort sit above or below their respective thresholds:
 *
 *   • Quick Wins    — HIGH value, LOW  effort (do these first)
 *   • Big Bets      — HIGH value, HIGH effort (strategic investments)
 *   • Fill-Ins      — LOW  value, LOW  effort (do if capacity allows)
 *   • Time Wasters  — LOW  value, HIGH effort (avoid)
 *
 * To keep PrioritizationItem.score sortable we attach a 1..4 quadrant
 * rank: Quick Wins=4, Big Bets=3, Fill-Ins=2, Time Wasters=1. This
 * means `list_items` ordered by score descending naturally surfaces
 * Quick Wins at the top of the agent's view, which is the order a PM
 * almost always wants.
 *
 * Default thresholds (5, 5) match the in-app client's `hiV = value >= 5,
 * hiE = effort >= 5` cut at value-effort-matrix-client.tsx:33-34, which
 * is the midpoint of the documented 1-10 input range. Callers can
 * override per-call when they're working on a different scale.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity, serverBulkUpsertEntities } from "../server-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

const KIND_PRIORITIZATION = "workspace:prioritization";
const FRAMEWORK = "value-effort" as const;

/**
 * Default midpoint thresholds for a 1-10 scale. Mirrors the in-app
 * client's `hiV = value >= 5, hiE = effort >= 5` (value-effort-matrix-client.tsx:33).
 * Comparison is `>=` so a value of exactly 5 lands on the high side
 * (matching the client) — boundary items aren't silently dropped to
 * the low side.
 */
const DEFAULT_VALUE_THRESHOLD = 5;
const DEFAULT_EFFORT_THRESHOLD = 5;

/** Snake_case quadrant key used in the agent-facing API. The in-app
 *  client uses display-cased "Quick Wins" etc. for the UI; here we
 *  expose machine-parseable keys so agents can branch on them without
 *  a string-normalisation step. */
export type Quadrant = "quick_wins" | "big_bets" | "fill_ins" | "time_wasters";

/** Sortable rank baked into PrioritizationItem.score so list_items
 *  ordered by score-desc surfaces Quick Wins first. */
const QUADRANT_SCORE: Record<Quadrant, number> = {
  quick_wins: 4,
  big_bets: 3,
  fill_ins: 2,
  time_wasters: 1,
};

function nowIso(): string {
  return new Date().toISOString();
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Classify (value, effort) into one of four quadrants.
 *
 * Effort is floored at 0.5 — the in-app client clamps to [1, 10] but
 * MCP/agent callers might hand us a raw 0 (or a missing field that
 * parses to 0), and a 0 effort would otherwise blow up any downstream
 * value/effort ratio. Matches the wsjf jobSize floor.
 *
 * Default thresholds are `(5, 5)` — the midpoint of the in-app 1-10
 * scale. Override `valueThreshold` / `effortThreshold` for other scales
 * (e.g. 50 on a 0-100 scale, 3 on a Fibonacci 1-5).
 */
export function classifyQuadrant(
  value: number,
  effort: number,
  valueThreshold = DEFAULT_VALUE_THRESHOLD,
  effortThreshold = DEFAULT_EFFORT_THRESHOLD
): Quadrant {
  const v = Math.max(0, num(value));
  const e = Math.max(0.5, num(effort, 0.5));
  const vt = num(valueThreshold, DEFAULT_VALUE_THRESHOLD);
  const et = num(effortThreshold, DEFAULT_EFFORT_THRESHOLD);
  const hiV = v >= vt;
  const hiE = e >= et;
  if (hiV && !hiE) return "quick_wins";
  if (hiV && hiE) return "big_bets";
  if (!hiV && !hiE) return "fill_ins";
  return "time_wasters";
}

/** Shared input shape for one Value/Effort candidate. */
const VEFieldsSchema = z.object({
  value: z.number().min(0).describe("Estimated value on the chosen scale (default scale 1-10)"),
  effort: z
    .number()
    .min(0)
    .describe(
      "Estimated effort on the chosen scale (default 1-10); floored at 0.5 to defuse div-by-zero downstream"
    ),
});

const ThresholdsSchema = z.object({
  valueThreshold: z
    .number()
    .min(0)
    .optional()
    .describe(`Boundary at or above which value is 'HIGH' (default ${DEFAULT_VALUE_THRESHOLD})`),
  effortThreshold: z
    .number()
    .min(0)
    .optional()
    .describe(`Boundary at or above which effort is 'HIGH' (default ${DEFAULT_EFFORT_THRESHOLD})`),
});

const VEItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: VEFieldsSchema,
});

// ──────── tool.value_effort_matrix.compute_quadrant ────────
// Pure: classify one (value, effort) pair into its quadrant.
registry.register({
  id: "tool.value_effort_matrix.compute_quadrant",
  toolId: "tool.value_effort_matrix",
  name: "compute_quadrant",
  category: "read",
  description:
    "Classify a single item into one of four quadrants (quick_wins, big_bets, fill_ins, time_wasters) based on value vs effort. Returns the quadrant key and a 1-4 sortable score (Quick Wins=4 … Time Wasters=1). Defaults to a midpoint threshold of (5, 5) on a 1-10 scale; override per-call for other scales.",
  paramsSchema: VEFieldsSchema.extend({
    valueThreshold: ThresholdsSchema.shape.valueThreshold,
    effortThreshold: ThresholdsSchema.shape.effortThreshold,
  }),
  handler: async (params) => {
    const quadrant = classifyQuadrant(
      params.value,
      params.effort,
      params.valueThreshold,
      params.effortThreshold
    );
    return {
      quadrant,
      score: QUADRANT_SCORE[quadrant],
      thresholds: {
        value: params.valueThreshold ?? DEFAULT_VALUE_THRESHOLD,
        effort: params.effortThreshold ?? DEFAULT_EFFORT_THRESHOLD,
      },
    };
  },
  // No mcpHandler — pure classification runs identically on server and client.
});

// ──────── tool.value_effort_matrix.compute_and_rank ────────
// Pure batch: classify many candidates and sort them by quadrant score.
registry.register({
  id: "tool.value_effort_matrix.compute_and_rank",
  toolId: "tool.value_effort_matrix",
  name: "compute_and_rank",
  category: "read",
  description:
    "Classify a batch of items into value/effort quadrants and return them sorted by quadrant score descending (Quick Wins first, Time Wasters last). Pure — no persistence. Ties preserve input order (stable sort) so the agent can use input order as a tiebreaker.",
  paramsSchema: z.object({
    items: z.array(VEItemInputSchema).min(1).max(500),
    valueThreshold: ThresholdsSchema.shape.valueThreshold,
    effortThreshold: ThresholdsSchema.shape.effortThreshold,
  }),
  handler: async (params) => {
    const vt = params.valueThreshold ?? DEFAULT_VALUE_THRESHOLD;
    const et = params.effortThreshold ?? DEFAULT_EFFORT_THRESHOLD;
    const ranked = params.items.map((it) => {
      const quadrant = classifyQuadrant(it.fields.value, it.fields.effort, vt, et);
      return {
        id: it.id ?? `ve_${Math.random().toString(36).slice(2, 10)}`,
        title: it.title,
        fields: { ...it.fields, quadrant },
        score: QUADRANT_SCORE[quadrant],
        quadrant,
      };
    });
    // Stable sort (V8 / Node 20): higher score first; ties keep input order.
    ranked.sort((a, b) => b.score - a.score);
    return {
      ranked,
      count: ranked.length,
      thresholds: { value: vt, effort: et },
    };
  },
});

// ──────── tool.value_effort_matrix.list_items ────────
// Read-only snapshot of value-effort items, grouped by quadrant.
registry.register({
  id: "tool.value_effort_matrix.list_items",
  toolId: "tool.value_effort_matrix",
  name: "list_items",
  category: "read",
  description:
    "List all prioritization items in the workspace scored by Value vs Effort, grouped by quadrant (quick_wins / big_bets / fill_ins / time_wasters). Filtered to framework='value-effort' so other frameworks (WSJF, RICE…) don't leak through. Each group is sorted by score descending (which for this framework is constant within a group, so input order is preserved).",
  paramsSchema: z.object({}),
  handler: async () => {
    const all = useWorkspaceStore.getState().prioritizations ?? [];
    const items = all.filter((x) => x.framework === FRAMEWORK);
    return groupByQuadrant(items);
  },
  mcpHandler: async (_params, ctx) => {
    const all = await serverListEntities<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION);
    const items = all.filter((x) => x.framework === FRAMEWORK);
    return groupByQuadrant(items);
  },
});

function groupByQuadrant(items: PrioritizationItem[]): {
  groups: Record<Quadrant, PrioritizationItem[]>;
  count: number;
} {
  const groups: Record<Quadrant, PrioritizationItem[]> = {
    quick_wins: [],
    big_bets: [],
    fill_ins: [],
    time_wasters: [],
  };
  for (const it of items) {
    // Prefer the persisted quadrant field; fall back to re-classifying
    // from value/effort if the row predates this action set or was
    // imported externally without a quadrant tag.
    const stored = String(it.fields?.quadrant ?? "")
      .toLowerCase()
      .replace(/[\s-]/g, "_");
    let q: Quadrant;
    if (
      stored === "quick_wins" ||
      stored === "big_bets" ||
      stored === "fill_ins" ||
      stored === "time_wasters"
    ) {
      q = stored;
    } else {
      // Legacy display-cased values from the in-app client: "Quick Wins" etc.
      const normalized = stored;
      if (normalized === "quick_wins") q = "quick_wins";
      else if (normalized === "big_bets") q = "big_bets";
      else if (normalized === "fill_ins") q = "fill_ins";
      else if (normalized === "time_wasters") q = "time_wasters";
      else {
        const v = num(it.fields?.value);
        const e = num(it.fields?.effort, 0.5);
        q = classifyQuadrant(v, e);
      }
    }
    groups[q].push(it);
  }
  return { groups, count: items.length };
}

// ──────── tool.value_effort_matrix.classify_and_persist ────────
// Convenience: classify one item AND save it to the workspace.
registry.register({
  id: "tool.value_effort_matrix.classify_and_persist",
  toolId: "tool.value_effort_matrix",
  name: "classify_and_persist",
  category: "write",
  description:
    "Classify a single item by value vs effort and persist it to workspace.prioritization with framework='value-effort'. Returns the saved item's id, quadrant, and 1-4 score. Common agent intent: 'plot this feature on my Value vs Effort matrix.'",
  paramsSchema: VEItemInputSchema.extend({
    valueThreshold: ThresholdsSchema.shape.valueThreshold,
    effortThreshold: ThresholdsSchema.shape.effortThreshold,
  }),
  handler: async (params) => {
    const item = buildPersistedItem(params);
    useWorkspaceStore.getState().upsertPrioritization(item);
    return {
      id: item.id,
      quadrant: item.fields?.quadrant as Quadrant,
      score: item.score!,
    };
  },
  mcpHandler: async (params, ctx) => {
    const item = buildPersistedItem(params);
    await serverUpsertEntity<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, item);
    return {
      id: item.id,
      quadrant: item.fields?.quadrant as Quadrant,
      score: item.score!,
    };
  },
});

function buildPersistedItem(params: {
  id?: string;
  title: string;
  fields: { value: number; effort: number };
  valueThreshold?: number;
  effortThreshold?: number;
}): PrioritizationItem {
  const effortFloored = Math.max(0.5, num(params.fields.effort, 0.5));
  const valueClean = Math.max(0, num(params.fields.value));
  const quadrant = classifyQuadrant(
    valueClean,
    effortFloored,
    params.valueThreshold,
    params.effortThreshold
  );
  return {
    id: params.id ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
    framework: FRAMEWORK,
    title: params.title.slice(0, 200),
    score: QUADRANT_SCORE[quadrant],
    fields: {
      value: valueClean,
      effort: effortFloored,
      quadrant,
    },
    status: "scored",
    updatedAt: nowIso(),
  };
}

// ──────── tool.value_effort_matrix.persist_to_prioritization ────────
// Bulk write of pre-classified items (typically the output of compute_and_rank).
// Each item upsert is idempotent; existing ids are overwritten.
registry.register({
  id: "tool.value_effort_matrix.persist_to_prioritization",
  toolId: "tool.value_effort_matrix",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of value/effort items to workspace.prioritization with framework='value-effort'. Items without an id get one generated; items with an existing id are overwritten (upsert by id). Each item is re-classified server-side from its value/effort so the persisted quadrant + 1-4 score are always consistent with the inputs.",
  paramsSchema: z.object({
    items: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string().min(1).max(200),
          fields: VEFieldsSchema,
        })
      )
      .min(1)
      .max(500),
    valueThreshold: ThresholdsSchema.shape.valueThreshold,
    effortThreshold: ThresholdsSchema.shape.effortThreshold,
  }),
  handler: async (params) => {
    const upsert = useWorkspaceStore.getState().upsertPrioritization;
    const written: string[] = [];
    for (const it of params.items) {
      const item = buildPersistedItem({
        id: it.id,
        title: it.title,
        fields: it.fields,
        valueThreshold: params.valueThreshold,
        effortThreshold: params.effortThreshold,
      });
      upsert(item);
      written.push(item.id);
    }
    return { written, count: written.length };
  },
  mcpHandler: async (params, ctx) => {
    const items: PrioritizationItem[] = params.items.map((it) =>
      buildPersistedItem({
        id: it.id,
        title: it.title,
        fields: it.fields,
        valueThreshold: params.valueThreshold,
        effortThreshold: params.effortThreshold,
      })
    );
    // Single round-trip for the batch — much faster than N individual
    // upserts when the agent is loading a backlog of 50+ items.
    await serverBulkUpsertEntities<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, items);
    return { written: items.map((i) => i.id), count: items.length };
  },
});
