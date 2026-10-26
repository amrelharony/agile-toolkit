/**
 * Kano Model — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     Feature classifier (Must-be / Performance / Attractive /
 *           Indifferent / Reverse / Questionable) from customers' answers.
 *
 * Agent surface: tool.kano_model.*
 * Backing CRUD : workspace.prioritization.* (auto-generated, shared with
 *                wsjf, ice-score, rice, moscow, eisenhower,
 *                cost-of-delay, weighted-decision)
 *
 * ─── The category is derived, never picked ───────────────────────────
 * Kano's paired question asks each customer "If it has this, how do you
 * feel?" (functional) and "If it doesn't have this, how do you feel?"
 * (dysfunctional), each on like / must / neutral / live_with / dislike.
 * The Kano evaluation table maps a pair to a class: A (attractive), O
 * (performance), M (must-be), I (indifferent), R (reverse) or Q
 * (questionable: the answers contradict each other). With survey counts
 * per class, the category is the most common class (ties M > O > A > I >
 * R > Q), and Better = (A+O)/(A+O+M+I), Worse = −(O+M)/(A+O+M+I); both
 * need 3 answers. All of it is the method registry's
 * (lib/prioritization/methods/kano), the code the page uses.
 *
 * `category` (a hand-picked category) is deprecated: accepted for one
 * release as a legacy "Picked by hand" row, never derived from.
 *
 * Score (PrioritizationItem.score) follows Decide order's ranking: cover
 * what customers expect before delighters — must-be 5, performance 4,
 * attractive 3, indifferent 2, reverse 1, questionable 0.
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { methodRow } from "@/lib/prioritization/binding";
import { method, scoreCache, type Values } from "@/lib/prioritization/methods";
import {
  EMPTY_KANO_COUNTS,
  KANO_ANSWERS,
  KANO_CATEGORIES,
  KANO_CATEGORY_MEANING,
  KANO_CLASSES,
  KANO_COUNT_KEYS,
  KANO_MIN_RESPONSES,
  KANO_RANK,
  addCounts,
  countTotal,
  countsFromJoint,
  kanoClass,
  kanoCoefficients,
  kanoCountFields,
  readKano,
  type KanoCategory,
  type KanoClass,
  type KanoCounts,
} from "@/lib/prioritization/methods/kano";
import {
  clientStore,
  listMethodRows,
  newRowId,
  persistMethodRows,
  serverStore,
  type MethodStore,
} from "./_method-rows";

const FRAMEWORK = "kano" as const;
const KANO = method(FRAMEWORK);

type CategoryId = KanoCategory;

const CategorySchema = z.enum(KANO_CATEGORIES);
const KanoAnswerSchema = z.enum(KANO_ANSWERS);

const CountsSchema = z
  .object(
    Object.fromEntries(KANO_CLASSES.map((k) => [k, z.number().int().min(0)])) as Record<
      KanoClass,
      z.ZodNumber
    >
  )
  .describe(
    "Survey counts: how many answer pairs came out A (attractive), O (performance), M (must-be), I (indifferent), R (reverse) and Q (questionable). The category and Better/Worse need 3 answers."
  );

/** Shared input shape for one Kano feature: a pair, counts, or (deprecated) a category. */
const KanoFieldsSchema = z
  .object({
    category: CategorySchema.optional().describe(
      "Deprecated: a hand-picked category. Accepted as a legacy 'Picked by hand' row; give functional + dysfunctional, or counts, instead."
    ),
    functional: KanoAnswerSchema.optional().describe(
      "Answer to 'If it has this, how do you feel?': like, must, neutral, live_with, dislike. With `dysfunctional`, the Kano evaluation table gives the class."
    ),
    dysfunctional: KanoAnswerSchema.optional().describe(
      "Answer to 'If it doesn't have this, how do you feel?'. Same scale as `functional`."
    ),
    counts: CountsSchema.optional(),
  })
  .refine(
    (v) =>
      v.counts !== undefined ||
      (v.functional !== undefined && v.dysfunctional !== undefined) ||
      v.category !== undefined,
    {
      message:
        "Give BOTH `functional` and `dysfunctional`, or survey `counts` (or the deprecated `category`).",
    }
  );

type KanoFields = z.infer<typeof KanoFieldsSchema>;

const KanoItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: KanoFieldsSchema,
  backlogItemId: z
    .string()
    .optional()
    .describe("Link the row to this backlog item, so the Prioritizer's Kano column shows it"),
});

/** The API's fields as the method's inputs (counts first, then the pair). */
function valuesOf(f: KanoFields): Values {
  const v: Values = {};
  if (f.counts) {
    // New counts are stored as typed-in ("counts"); the same counts as stored keep their source.
    for (const k of KANO_CLASSES) v[KANO_COUNT_KEYS[k]] = f.counts[k];
  } else if (f.functional && f.dysfunctional) {
    v.functional = f.functional;
    v.dysfunctional = f.dysfunctional;
  }
  return v;
}

/** Only the deprecated category was given. */
const pickedOnly = (f: KanoFields) =>
  !f.counts && !(f.functional && f.dysfunctional) && f.category !== undefined;

/** Pure classifier: a pair, counts or a picked category → the full reading. */
function classify(f: KanoFields) {
  const values = valuesOf(f);
  const r = pickedOnly(f) ? KANO.evaluate({ category: f.category }) : KANO.evaluate(values);
  const category = (r.bucket as CategoryId | null) ?? null;
  const counts: KanoCounts | null = f.counts ?? null;
  const coefficients = counts ? kanoCoefficients(counts) : null;
  const n = typeof r.extra?.n === "number" ? r.extra.n : 0;
  return {
    class:
      f.functional && f.dysfunctional && !f.counts
        ? kanoClass(f.functional, f.dysfunctional)
        : null,
    category,
    score: category ? KANO_RANK[category] : null,
    explanation: category
      ? KANO_CATEGORY_MEANING[category]
      : `Not enough answers yet: the category shows from ${KANO_MIN_RESPONSES}.`,
    counts,
    n,
    better: coefficients && n >= KANO_MIN_RESPONSES ? coefficients.better : null,
    worse: coefficients && n >= KANO_MIN_RESPONSES ? coefficients.worse : null,
    enough: counts ? n >= KANO_MIN_RESPONSES : category !== null,
    picked: pickedOnly(f),
  };
}

// ──────── tool.kano_model.classify ────────
// Pure: classify one feature. No persistence, no side effects.
registry.register({
  id: "tool.kano_model.classify",
  toolId: "tool.kano_model",
  name: "classify",
  category: "read",
  description:
    "Classify one feature with the Kano evaluation table, as the page does. Give a (`functional`, `dysfunctional`) answer pair (like / must / neutral / live_with / dislike) or survey `counts` {A, O, M, I, R, Q}. Returns { class, category ('must-be' | 'performance' | 'attractive' | 'indifferent' | 'reverse' | 'questionable', or null under 3 counted answers), score, explanation, counts, n, better, worse, enough }. (like, like) and (dislike, dislike) are Questionable. Score (Decide order's ranking): must-be=5, performance=4, attractive=3, indifferent=2, reverse=1, questionable=0. `category` alone is deprecated.",
  paramsSchema: KanoFieldsSchema,
  handler: async (params) => classify(params),
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.kano_model.list_items ────────
// Read-only snapshot of Kano features, grouped by derived category.
const listItems = async (store: MethodStore) => {
  const listed = await listMethodRows(store, FRAMEWORK);
  const grouped = Object.fromEntries(
    [...KANO_CATEGORIES, "unanswered"].map((c) => [c, [] as typeof listed])
  ) as Record<CategoryId | "unanswered", typeof listed>;
  for (const row of listed) grouped[(row.bucket as CategoryId | null) ?? "unanswered"].push(row);
  // Each group newest first: agents usually want "what did I just add" at the top.
  for (const c of Object.keys(grouped) as (CategoryId | "unanswered")[]) {
    grouped[c].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return { ...grouped, total: listed.length };
};

registry.register({
  id: "tool.kano_model.list_items",
  toolId: "tool.kano_model",
  name: "list_items",
  category: "read",
  description:
    "List all Kano features in the workspace, grouped by their derived category: { 'must-be', performance, attractive, indifferent, reverse, questionable, unanswered, total }. A feature with no answers, or fewer than 3 counted answers, is under unanswered (never Performance by default). Each row carries {score, bucket, extra: {n, better, worse, source, …}}; each group is newest first. Filtered to framework='kano'.",
  paramsSchema: z.object({}),
  handler: async () => listItems(clientStore()),
  mcpHandler: async (_params, ctx) => listItems(serverStore(ctx.userId)),
});

/** Persist features; a deprecated category-only one is stored as "Picked by hand". */
async function persistFeatures(
  store: MethodStore,
  items: readonly { id?: string; title: string; fields: KanoFields; backlogItemId?: string }[]
) {
  const answered = items.filter((it) => !pickedOnly(it.fields));
  const saved = await persistMethodRows(
    store,
    FRAMEWORK,
    answered.map((it) => ({
      id: it.id,
      title: it.title,
      values: valuesOf(it.fields),
      backlogItemId: it.backlogItemId,
    }))
  );
  const byInput = new Map(answered.map((it, i) => [it, saved[i].row]));
  const picked: PrioritizationItem[] = [];
  for (const it of items) {
    if (!pickedOnly(it.fields)) continue;
    const existing = it.id ? await store.row(it.id) : undefined;
    const prev = existing && existing.framework === FRAMEWORK ? existing : undefined;
    const link = it.backlogItemId ?? prev?.backlogItemId;
    const linked = link ? await store.item(link) : undefined;
    if (it.backlogItemId && !linked) throw new Error(`No backlog item ${it.backlogItemId}.`);
    const base = methodRow({
      id: it.id ?? newRowId(),
      framework: FRAMEWORK,
      title: it.title,
      values: {},
      prev,
      backlogItemId: linked ? linked.id : prev?.backlogItemId ? prev.backlogItemId : null,
    });
    // Legacy path: the hand-picked category the page reads as "Picked by hand".
    const fields = { ...base.fields, category: it.fields.category as string };
    const r = KANO.evaluate(KANO.read(fields));
    const row: PrioritizationItem = {
      ...base,
      fields,
      score: r.score ?? undefined,
      status: "scored",
    };
    picked.push(row);
    byInput.set(it, row);
  }
  if (picked.length > 0) await store.putRows(picked);
  return items.map((it) => {
    const row = byInput.get(it) as PrioritizationItem;
    const c = classify(it.fields);
    return { row, ...c };
  });
}

// ──────── tool.kano_model.classify_and_persist ────────
// Convenience: classify one feature AND save it to the workspace.
const classifyAndPersist = async (
  store: MethodStore,
  params: z.infer<typeof KanoItemInputSchema>
) => {
  const [r] = await persistFeatures(store, [params]);
  return {
    id: r.row.id,
    category: r.category,
    score: r.score,
    explanation: r.explanation,
    class: r.class,
    n: r.n,
    better: r.better,
    worse: r.worse,
    enough: r.enough,
  };
};

registry.register({
  id: "tool.kano_model.classify_and_persist",
  toolId: "tool.kano_model",
  name: "classify_and_persist",
  category: "write",
  description:
    "Classify one feature (a (functional, dysfunctional) pair, or survey counts) and persist it to workspace.prioritization with framework='kano'. The answers are stored (functional/dysfunctional, or kanoA…kanoQ + kanoN); the category is derived on read, never stored, and PrioritizationItem.score is its rank (must-be 5 … questionable 0). An existing id keeps its other fields and its backlog link. Returns { id, category, score, explanation, class, n, better, worse, enough }.",
  paramsSchema: KanoItemInputSchema,
  handler: async (params) => classifyAndPersist(clientStore(), params),
  mcpHandler: async (params, ctx) => classifyAndPersist(serverStore(ctx.userId), params),
});

// ──────── tool.kano_model.persist_to_prioritization ────────
// Bulk write of features; each is classified the same way, so a batch can
// mix pairs and counts. requiresConfirmation:false because each upsert is
// idempotent by id.
const PersistSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1).max(200),
        fields: KanoFieldsSchema,
        backlogItemId: z.string().optional().describe("Link the row to this backlog item"),
      })
    )
    .min(1)
    .max(500),
});

const persistAll = async (store: MethodStore, params: z.infer<typeof PersistSchema>) => {
  const results = await persistFeatures(store, params.items);
  const written = results.map((r) => ({ id: r.row.id, category: r.category, score: r.score }));
  return { written, count: written.length };
};

registry.register({
  id: "tool.kano_model.persist_to_prioritization",
  toolId: "tool.kano_model",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of Kano features to workspace.prioritization. Each item supplies title + fields ({ functional, dysfunctional } or { counts }); the category and sort score are derived. Items without an id get one generated; an existing id is updated in place, keeping its other fields and backlog link.",
  paramsSchema: PersistSchema,
  handler: async (params) => persistAll(clientStore(), params),
  mcpHandler: async (params, ctx) => persistAll(serverStore(ctx.userId), params),
});

// ──────── tool.kano_model.record_round ────────
// A survey round's totals for one feature, as the page's Save round stores
// them: the class counts, or the 5×5 joint count of answer pairs that a
// vote round keeps, folded into class counts by the evaluation table.
// Totals only: nothing per person is accepted or stored.
const JointSchema = z
  .array(z.number().int().min(0))
  .length(KANO_ANSWERS.length * KANO_ANSWERS.length)
  .describe(
    "The 5×5 joint count of answer pairs: joint[first × 5 + second] people answered `first` to 'If it has this, how do you feel?' and `second` to 'If it doesn't?', both in the order like, must, neutral, live_with, dislike (a vote round's PairRoundResult item joint)."
  );

const RecordRoundSchema = z
  .object({
    featureId: z.string().min(1).describe("The Kano feature (list_items ids)"),
    counts: CountsSchema.optional(),
    joint: JointSchema.optional(),
    add: z
      .boolean()
      .optional()
      .describe(
        "Add to the feature's earlier answers (its counts, or its one answer pair as one answer). Default false: the round's counts REPLACE them, as the page's Save round does."
      ),
    source: z
      .enum(["room", "tally"])
      .optional()
      .describe(
        "Where the totals came from: 'room' (a live vote round) or 'tally' (default: counted by hand or in another survey tool)"
      ),
    roundId: z.string().min(1).max(64).optional().describe("The round's id, kept on the feature"),
    at: z
      .string()
      .max(40)
      .optional()
      .describe("When the round closed (ISO timestamp); default now"),
  })
  .refine((p) => (p.counts === undefined) !== (p.joint === undefined), {
    message: "Give exactly one of `counts` or `joint`.",
  });

/** A feature's answers before a round, as counts: its counts, or its one pair as one answer. */
function earlierCounts(fields: PrioritizationItem["fields"]): KanoCounts | null {
  const r = readKano(fields);
  if (r.counts) return r.counts;
  if (r.pair) {
    return { ...EMPTY_KANO_COUNTS, [kanoClass(r.pair.functional, r.pair.dysfunctional)]: 1 };
  }
  return null;
}

const recordRound = async (store: MethodStore, p: z.infer<typeof RecordRoundSchema>) => {
  const row = await store.row(p.featureId);
  if (!row || row.framework !== FRAMEWORK) {
    throw new Error(`No Kano feature ${p.featureId}: list them with tool.kano_model.list_items.`);
  }
  const fresh = p.counts ?? countsFromJoint(p.joint ?? []);
  if (!fresh) throw new Error("The joint must hold 25 whole numbers, 0 or more.");
  if (countTotal(fresh) === 0) throw new Error("The round has no answers for this feature.");
  const earlier = earlierCounts(row.fields);
  const counts = p.add && earlier ? addCounts(earlier, fresh) : fresh;
  const now = new Date().toISOString();
  const fields = kanoCountFields(row.fields, counts, {
    source: p.source ?? "tally",
    roundId: p.roundId,
    at: p.at ?? now,
  });
  const result = KANO.evaluate(KANO.read(fields));
  const cache = scoreCache(result, row.status);
  const next: PrioritizationItem = { ...row, fields, status: cache.status, updatedAt: now };
  if (cache.score === undefined) delete next.score;
  else next.score = cache.score;
  await store.putRows([next]);
  const n = countTotal(counts);
  const enough = n >= KANO_MIN_RESPONSES;
  const coefficients = enough ? kanoCoefficients(counts) : null;
  return {
    id: row.id,
    category: (result.bucket as CategoryId | null) ?? null,
    score: result.score,
    counts,
    n,
    better: coefficients?.better ?? null,
    worse: coefficients?.worse ?? null,
    enough,
    replaced: !p.add && earlier !== null,
    previous: earlier ? { counts: earlier, n: countTotal(earlier) } : null,
  };
};

registry.register({
  id: "tool.kano_model.record_round",
  toolId: "tool.kano_model",
  name: "record_round",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a survey round's totals for one existing Kano feature, as the page's Save round does: give `counts` {A, O, M, I, R, Q} or the round's 5×5 `joint` of answer pairs (folded into class counts by the Kano evaluation table). Totals only, never per-person answers. The round's counts REPLACE the feature's earlier answers unless add: true (then they are added, a single stored answer pair counting as one). The category (most common class; ties M > O > A > I > R > Q) and Better/Worse show from 3 answers. Returns { id, category (null under 3 answers), score, counts, n, better, worse, enough, replaced, previous: {counts, n} | null }.",
  paramsSchema: RecordRoundSchema,
  handler: async (params) => recordRound(clientStore(), params),
  mcpHandler: async (params, ctx) => recordRound(serverStore(ctx.userId), params),
});
