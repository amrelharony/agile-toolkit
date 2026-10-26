/**
 * Prioritizer — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1)
 * Agent surface: tool.prioritizer.*
 * Backing CRUD : workspace.backlog_item.* (auto-generated).
 *
 *   1. list_state   — backlog items with every method's score (null when
 *                     not scored), the decided order, a WSJF-descending
 *                     ranking and the MoSCoW breakdown, the same as the
 *                     Prioritizer's tabs.
 *   2. add_item     — add a backlog item; every method it isn't given starts
 *                     Not scored (no mid-range defaults).
 *   3. decide_order — the per-method ranks and the Borda consensus the
 *                     Prioritizer's Decide order step starts from (read).
 *   4. set_order    — save a decided order: ranks 1..N to the ids given,
 *                     every other item back to Not ordered yet.
 *
 * Every score comes from the method registry (lib/prioritization/methods)
 * through lib/prioritization/scores.ts and rank.ts, the code the page uses,
 * so the agent's numbers match the screen. Entity kind
 * "workspace:backlogItem" (camelCase via kindFromToolId) matches the
 * browser sync engine so writes round-trip.
 */

import { z } from "zod";
import { registry } from "../registry";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { REACH_PERIODS } from "@/lib/stores/workspace-types";
import { applyItemPatch } from "@/lib/prioritization/binding";
import { createBacklogItem } from "@/lib/prioritization/frameworks";
import { readBacklogItem } from "@/lib/prioritization/defaults";
import {
  HUB_METHOD_IDS,
  evaluateItem,
  method,
  type MethodId,
  type MethodScore,
} from "@/lib/prioritization/methods";
import { frameworkScores } from "@/lib/prioritization/scores";
import {
  bordaConsensus,
  consensusMethods,
  decidedOrder,
  ranksFromOrder,
} from "@/lib/prioritization/rank";
import {
  FIBONACCI_TEXT,
  FIBONACCI_VALUES,
  isFibonacci,
} from "@/lib/prioritization/methods/fibonacci";
import { clientStore, serverStore, type MethodStore } from "./_method-rows";

/** One method's result for an item, as list_state reports it. */
const resultOf = (s: MethodScore) => ({
  score: s.score,
  bucket: s.bucket,
  missing: s.missing,
  warnings: s.warnings,
});

/** `rows` are the method tools' rows; the ones linked to an item feed its ICE, Kano and Cost of Delay. */
function summarize(items: readonly BacklogItem[], rows: readonly PrioritizationItem[] = []) {
  const byMoscow: Record<NonNullable<BacklogItem["moscow"]>, number> = {
    must: 0,
    should: 0,
    could: 0,
    wont: 0,
  };
  const scored = items.map((i) => {
    const fs = frameworkScores(i, rows);
    const all = evaluateItem(i, rows);
    const methods = Object.fromEntries(
      HUB_METHOD_IDS.map((id) => [id, resultOf(all[id])])
    ) as Record<MethodId, ReturnType<typeof resultOf>>;
    return {
      id: i.id,
      name: i.name,
      moscow: fs.moscow,
      wsjf: fs.wsjf,
      rice: fs.rice,
      rank: typeof i.rank === "number" ? i.rank : null,
      frameworkScores: fs,
      methods,
    };
  });
  // An item without a bucket (or whose bucket is only an old default) is counted nowhere.
  for (const s of scored) if (s.moscow) byMoscow[s.moscow] += 1;
  const rankedByWsjf = [...scored].sort((a, b) => (b.wsjf ?? -Infinity) - (a.wsjf ?? -Infinity));
  const byId = new Map(scored.map((s) => [s.id, s]));
  const ordered = decidedOrder(items).map((i) => byId.get(i.id)!);
  return {
    total: items.length,
    byMoscow,
    notSorted: scored.filter((s) => !s.moscow).length,
    items: scored,
    rankedByWsjf,
    ordered,
  };
}

const listState = async (store: MethodStore) => {
  const [items, rows] = await Promise.all([store.items(), store.rows()]);
  return summarize(items, rows);
};

// ──────── tool.prioritizer.list_state ────────
registry.register({
  id: "tool.prioritizer.list_state",
  toolId: "tool.prioritizer",
  name: "list_state",
  category: "read",
  description:
    "List backlog items with computed scores. Returns {total, byMoscow: {must, should, could, wont}, notSorted, items: {id, name, moscow, wsjf, rice, rank, frameworkScores, methods}[], rankedByWsjf: same[] sorted by WSJF descending (not scored last), ordered: same[] in the decided order (rank 1 first, then items not ordered yet)}. A method the item isn't scored in reads null (never a mid-range default; old 'Add item' defaults read as not scored). frameworkScores: {moscow, wsjf, rice, valueEffort: {value, effort, quadrant: quick_wins|big_bets|fill_ins|time_wasters} | null} from the item's own inputs, plus {ice, kano, cd3, urgency} from the latest row in those tools linked to it (costOfDelay: deprecated, the old total). methods: each hub method's {score, bucket, missing, warnings}.",
  paramsSchema: z.object({}),
  handler: async () => listState(clientStore()),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

// ──────── tool.prioritizer.add_item ────────
const FIB = FIBONACCI_VALUES.join(", ");
/** A new item's WSJF part (and its one value field); addItem checks the scale. */
const FibonacciPart = z.number().optional();
/** The WSJF parts add_item takes, each checked against the scale. */
const WSJF_PARTS = ["businessValue", "timeCriticality", "riskReduction", "jobSize"] as const;
const AddItemSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  moscow: z.enum(["must", "should", "could", "wont"]).optional(),
  businessValue: FibonacciPart.describe(
    `The item's value (WSJF and the Value/Effort matrix), Fibonacci ${FIB}`
  ),
  timeCriticality: FibonacciPart.describe(`WSJF time criticality, Fibonacci ${FIB}`),
  riskReduction: FibonacciPart.describe(`WSJF risk reduction, Fibonacci ${FIB}`),
  jobSize: FibonacciPart.describe(`WSJF job size, Fibonacci ${FIB}`),
  reach: z.number().min(0).optional().describe("RICE reach per reachPeriod"),
  reachPeriod: z.enum(REACH_PERIODS).optional().describe("RICE reach period (default quarter)"),
  impact: z
    .number()
    .positive()
    .optional()
    .describe("RICE impact: 3, 2, 1, 0.5 or 0.25 (exact value kept)"),
  confidence: z.number().min(0).max(100).optional().describe("RICE confidence, percent"),
  effort: z.number().min(0.5).optional().describe("RICE effort, person-months (0.5 at least)"),
  matrixEffort: z.number().min(1).max(10).optional().describe("Value/Effort effort, 1-10"),
});

const addItem = async (store: MethodStore, params: z.infer<typeof AddItemSchema>) => {
  const { name, description, ...inputs } = params;
  // The rule tool.wsjf and tool.value_effort_matrix writes follow: a step
  // of the scale (a new item holds nothing to keep as Custom).
  const off = WSJF_PARTS.filter((k) => {
    const v = inputs[k];
    return v !== undefined && !isFibonacci(v);
  });
  if (off.length > 0) {
    throw new Error(`${off.join(", ")}: each WSJF part is one of ${FIBONACCI_TEXT}.`);
  }
  const item = createBacklogItem(name, {
    ...inputs,
    description: description?.trim() || undefined,
  });
  await store.putItem(item);
  return { added: true, id: item.id };
};

registry.register({
  id: "tool.prioritizer.add_item",
  toolId: "tool.prioritizer",
  name: "add_item",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a backlog item. Only the inputs given are stored: every method it isn't given starts Not scored (no default bucket, no mid values). businessValue is the one value field (WSJF and Value/Effort). Returns {added: true, id}.",
  paramsSchema: AddItemSchema,
  handler: async (params) => addItem(clientStore(), params),
  mcpHandler: async (params, ctx) => addItem(serverStore(ctx.userId), params),
});

// ──────── tool.prioritizer.decide_order ────────
const DecideSchema = z.object({
  methods: z
    .array(z.enum(HUB_METHOD_IDS as unknown as [MethodId, ...MethodId[]]))
    .optional()
    .describe("Methods to combine (default: every hub method with 2 or more scored items)"),
});

const decideOrder = async (store: MethodStore, params: z.infer<typeof DecideSchema>) => {
  const [items, rows] = await Promise.all([store.items(), store.rows()]);
  const { used, skipped } = consensusMethods(items, rows, params.methods ?? HUB_METHOD_IDS);
  const ids = used.map((r) => r.method);
  const consensus = bordaConsensus(items, rows, ids);
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    methods: ids,
    skipped: skipped.map((s) => ({
      method: s.method,
      label: method(s.method).label,
      scored: s.n,
      reason: s.n === 0 ? "no item scored" : "only 1 item scored",
    })),
    consensus: consensus.map((c) => ({
      id: c.itemId,
      name: byId.get(c.itemId)?.name ?? "",
      rank: byId.get(c.itemId)?.rank ?? null,
      borda: c.borda === null ? null : Math.round(c.borda * 1000) / 10,
      coverage: c.coverage,
      spread: c.spread,
      disagree: c.spread !== null && c.spread > 0.5,
      perMethod: c.perMethod,
    })),
    suggestedOrder: consensus.filter((c) => c.borda !== null).map((c) => c.itemId),
    unscored: consensus.filter((c) => c.borda === null).map((c) => c.itemId),
  };
};

registry.register({
  id: "tool.prioritizer.decide_order",
  toolId: "tool.prioritizer",
  name: "decide_order",
  category: "read",
  description:
    "The Prioritizer's Decide order, as the page computes it: each method's normalised rank (tied items share the average place) and the Borda consensus. Returns {methods (used), skipped (methods with fewer than 2 scored items, and why), consensus: {id, name, rank, borda (0-100, 100 = top in every method that scored it), coverage (methods that scored it), spread (0-1; disagree when over 0.5), perMethod (place per method)}[] best first with unscored items last, suggestedOrder (ids), unscored (ids)}. Read-only: save an order with set_order.",
  paramsSchema: DecideSchema,
  handler: async (params) => decideOrder(clientStore(), params),
  mcpHandler: async (params, ctx) => decideOrder(serverStore(ctx.userId), params),
});

// ──────── tool.prioritizer.set_order ────────
const SetOrderSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .max(1000)
    .describe(
      "Backlog item ids in the decided order (first = rank 1). Items not listed become Not ordered yet."
    ),
});

const setOrder = async (store: MethodStore, params: z.infer<typeof SetOrderSchema>) => {
  const items = await store.items();
  const known = new Set(items.map((i) => i.id));
  const unknown = params.ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown backlog item ids: ${unknown.join(", ")}. Nothing was changed.`);
  }
  const ranks = ranksFromOrder(params.ids);
  const now = new Date().toISOString();
  let changed = 0;
  for (const item of items) {
    const next = ranks.get(item.id);
    const cur = readBacklogItem(item).rank;
    if (next === cur || (next === undefined && cur === undefined)) continue;
    await store.putItem(applyItemPatch(item, { rank: next }, now));
    changed += 1;
  }
  return { ranked: ranks.size, unranked: items.length - ranks.size, changed };
};

registry.register({
  id: "tool.prioritizer.set_order",
  toolId: "tool.prioritizer",
  name: "set_order",
  category: "write",
  requiresConfirmation: true,
  description:
    "Save the backlog's decided order, as the Prioritizer's 'Save order' does: rank 1..N to the ids given (in that order), and every item not listed back to Not ordered yet. Unknown ids are refused and nothing is changed. Sprint Planning imports in this order. Returns {ranked, unranked, changed}.",
  paramsSchema: SetOrderSchema,
  handler: async (params) => setOrder(clientStore(), params),
  mcpHandler: async (params, ctx) => setOrder(serverStore(ctx.userId), params),
});
