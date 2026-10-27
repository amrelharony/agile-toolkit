/**
 * Prioritizer — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1)
 * Agent surface: tool.prioritizer.*
 * Backing CRUD : workspace.backlog_item.* (auto-generated).
 *
 *   1. list_state   — backlog items with every method's score (null when
 *                     not scored), each method's place for the item and
 *                     the consensus (the Decide order step's table), the
 *                     decided order, a WSJF-descending ranking and the
 *                     MoSCoW breakdown, the same as the Prioritizer's tabs.
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
import { readBacklogItem, savedByEngine } from "@/lib/prioritization/defaults";
import {
  HUB_METHOD_IDS,
  evaluateItem,
  markLegacyDifferences,
  method,
  withLegacyLinks,
  type MethodId,
  type MethodScore,
  type Values,
} from "@/lib/prioritization/methods";
import { frameworkScores } from "@/lib/prioritization/scores";
import {
  DISAGREE_SPREAD,
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

/** A consensus as decide_order reports it: 0–100, one decimal place. */
const bordaPercent = (borda: number | null) =>
  borda === null ? null : Math.round(borda * 1000) / 10;

/** `rows` are the method tools' rows; the ones linked to an item feed its ICE, Kano and Cost of Delay. */
function summarize(items: readonly BacklogItem[], rows: readonly PrioritizationItem[] = []) {
  const byMoscow: Record<NonNullable<BacklogItem["moscow"]>, number> = {
    must: 0,
    should: 0,
    could: 0,
    wont: 0,
  };
  // Each method's places and the consensus over every hub method with 2 or
  // more items scored: the Decide order step's default table (rank.ts).
  const { used } = consensusMethods(items, rows, HUB_METHOD_IDS);
  const consensus = new Map(
    bordaConsensus(
      items,
      rows,
      used.map((r) => r.method)
    ).map((c) => [c.itemId, c])
  );
  const scored = items.map((i) => {
    const fs = frameworkScores(i, rows);
    const all = evaluateItem(i, rows);
    const methods = Object.fromEntries(
      HUB_METHOD_IDS.map((id) => [id, resultOf(all[id])])
    ) as Record<MethodId, ReturnType<typeof resultOf>>;
    const c = consensus.get(i.id);
    return {
      id: i.id,
      name: i.name,
      moscow: fs.moscow,
      wsjf: fs.wsjf,
      rice: fs.rice,
      rank: typeof i.rank === "number" ? i.rank : null,
      frameworkScores: fs,
      methods,
      methodRanks: c?.perMethod ?? {},
      consensus: bordaPercent(c?.borda ?? null),
      coverage: c?.coverage ?? 0,
      disagree: typeof c?.spread === "number" && c.spread > DISAGREE_SPREAD,
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
    rankedMethods: used.map((r) => r.method),
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
    "List backlog items with computed scores, as the Prioritizer shows them. Returns {total, byMoscow: {must, should, could, wont}, notSorted, items: {id, name, moscow, wsjf, rice, rank, frameworkScores, methods, methodRanks, consensus, coverage, disagree}[], rankedByWsjf: same[] sorted by WSJF descending (not scored last), ordered: same[] in the decided order (rank 1 first, then items not ordered yet), rankedMethods: the hub methods with 2 or more items scored}. rank: the decided order's place (1-based), null = Not ordered yet. A method the item isn't scored in reads null (never a mid-range default; old 'Add item' defaults read as not scored). frameworkScores: {moscow, wsjf, rice, valueEffort: {value, effort, quadrant: quick_wins|big_bets|fill_ins|time_wasters} | null} from the item's own inputs, plus {ice, kano, cd3, urgency} from the latest row in those tools linked to it (costOfDelay: deprecated, the old total). methods: each hub method's {score, bucket, missing, warnings}. methodRanks: the item's place in each of rankedMethods that scored it (tied items share the average place, e.g. 2.5), the Decide order step's table; consensus: the Borda consensus over rankedMethods, 0-100 (100 = top in every method that scored it), null when none did; coverage: how many of rankedMethods scored it; disagree: those methods' places for it are over half the list apart (decide_order's flag).",
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
  // Trimmed first, as the hub's Add item: a name of spaces is no name.
  name: z.string().trim().min(1).max(200),
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
  confidence: z
    .number()
    .gt(0)
    .max(100)
    .optional()
    .describe("RICE confidence, percent: more than 0, up to 100"),
  effort: z.number().min(0.5).optional().describe("RICE effort, person-months (0.5 at least)"),
  matrixEffort: z.number().min(1).max(10).optional().describe("Value/Effort effort, 1-10"),
});

/** The methods whose other inputs add_item takes (WSJF's parts are checked on their own). */
const CHECKED_METHODS = ["rice", "value-effort"] as const;

/**
 * The hub editors' rules for the inputs given: each method's own validate
 * (lib/prioritization/methods), so the agent can't store what the page
 * refuses (a RICE confidence of 0, which would score 0). A method's inputs
 * that aren't given are no error here: the method stays Not scored.
 */
function inputProblems(inputs: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const id of CHECKED_METHODS) {
    const m = method(id);
    const draft: Values = {};
    for (const input of m.inputs) {
      const v = input.backlogKey ? inputs[input.backlogKey] : undefined;
      if (typeof v === "number" || typeof v === "string") draft[input.key] = v;
    }
    if (Object.keys(draft).length === 0) continue;
    const checked = m.validate(draft);
    if (checked.ok) continue;
    for (const input of m.inputs) {
      const message = checked.errors[input.key];
      if (message && input.key in draft) problems.push(`${input.backlogKey}: ${message}`);
    }
  }
  return problems;
}

const addItem = async (store: MethodStore, params: z.infer<typeof AddItemSchema>) => {
  const { name: given, description, ...inputs } = params;
  // The schema trims; this holds for a handler called without it too.
  const name = given.trim();
  if (!name) throw new Error("name: an item needs a name. Nothing was added.");
  // The rule tool.wsjf and tool.value_effort_matrix writes follow: a step
  // of the scale (a new item holds nothing to keep as Custom).
  const off = WSJF_PARTS.filter((k) => {
    const v = inputs[k];
    return v !== undefined && !isFibonacci(v);
  });
  if (off.length > 0) {
    throw new Error(`${off.join(", ")}: each WSJF part is one of ${FIBONACCI_TEXT}.`);
  }
  const problems = inputProblems(inputs);
  if (problems.length > 0) throw new Error(`${problems.join(" ")} Nothing was added.`);
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
    "Add a backlog item, as the Prioritizer's Add item does. Only the inputs given are stored: every method it isn't given starts Not scored (no default bucket, no mid values), and the item is Not ordered yet (no rank) until a decided order is saved (set_order). businessValue is the one value field (WSJF and Value/Effort); each WSJF part is a Fibonacci step 1, 2, 3, 5, 8, 13 or 20 (refused otherwise, no clamp). The name is trimmed (one of only spaces is refused). The RICE and Value/Effort inputs given are checked with the hub editors' rules (RICE confidence more than 0 and up to 100, effort 0.5 person-months at least; Value/Effort effort 1-10) and refused otherwise, with nothing added; a method given only some of its inputs stays Not scored. Returns {added: true, id}.",
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
      borda: bordaPercent(c.borda),
      coverage: c.coverage,
      spread: c.spread,
      disagree: c.spread !== null && c.spread > DISAGREE_SPREAD,
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

/**
 * Save a decided order, as the page's Save order does (saveBacklogItem
 * {rank} on each item it changes). An item the new code never saved is
 * saved from what its links made before Phase 7 say it reads
 * (withLegacyLinks), so its first save keeps their values, and the legacy
 * rows that disagree with it are marked first (markLegacyDifferences), so
 * their tools still ask which value to keep. Both read the rows as they
 * were before the save.
 */
const setOrder = async (store: MethodStore, params: z.infer<typeof SetOrderSchema>) => {
  const items = await store.items();
  const known = new Set(items.map((i) => i.id));
  const unknown = params.ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown backlog item ids: ${unknown.join(", ")}. Nothing was changed.`);
  }
  const ranks = ranksFromOrder(params.ids);
  const now = new Date().toISOString();
  const changes = items.filter((item) => {
    const next = ranks.get(item.id);
    const cur = readBacklogItem(item).rank;
    return !(next === cur || (next === undefined && cur === undefined));
  });
  // Only an unstamped item reads its rows: no list is fetched otherwise.
  const rows = changes.some((item) => !savedByEngine(item)) ? await store.rows() : [];
  const written = changes.map((item) => ({
    item,
    next: applyItemPatch(withLegacyLinks(item, rows), { rank: ranks.get(item.id) }, now),
  }));
  const marks = written.flatMap(({ item, next }) =>
    markLegacyDifferences(item, rows, { now, after: next })
  );
  if (marks.length > 0) await store.putRows(marks);
  for (const { next } of written) await store.putItem(next);
  return { ranked: ranks.size, unranked: items.length - ranks.size, changed: changes.length };
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
