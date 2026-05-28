/**
 * Kano Model — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     5-bucket feature classifier (Must-Be / Performance /
 *           Attractive / Indifferent / Reverse) for product backlog
 *           prioritisation based on customer-satisfaction response curves.
 *
 * Agent surface: tool.kano_model.*
 * Backing CRUD : workspace.prioritization.* (auto-generated, shared with
 *                wsjf, ice-score, rice, moscow, eisenhower,
 *                cost-of-delay, weighted-decision)
 *
 * ─── CLASSIFIER variant of the calc-tool pattern ─────────────────────
 * Like Eisenhower, Kano produces a discrete category rather than a
 * scalar score. We still surface a numeric `score` (5/4/3/2/1) so the
 * shared `PrioritizationItem.score` sort column produces a sensible
 * cross-framework order (delight at the top, reverse-features at the
 * bottom). The mapping mirrors classic Kano impact: attractive features
 * generate the steepest satisfaction lift per delivered unit, then
 * performance, then must-be (baseline expectations), then indifferent,
 * with reverse penalised below all.
 *
 * ─── Category-id divergence (kano-model-client.tsx vs the task spec) ─
 * The squad brief named the buckets "basic / performance / excitement /
 * indifferent / reverse" (Kano's original textbook nomenclature). The
 * in-app client at kano-model-client.tsx:25 persists `fields.category`
 * as "must-be" | "performance" | "attractive" | "indifferent" |
 * "reverse" — common modern product-management vocabulary where Kano's
 * "basic" is rendered "Must-Be" and "excitement" is rendered
 * "Attractive". To keep agent writes and UI writes roundtrip-
 * compatible (an agent persisting a feature should land in the right
 * column without the client's fallback at line 107 silently coercing
 * it back to "performance"), we adopt the CLIENT'S vocabulary. The
 * textbook names (basic / excitement) appear in description strings so
 * the agent still understands the intent.
 *
 * The score mapping in the brief — excitement=5, performance=4,
 * basic=3, indifferent=2, reverse=1 — therefore renders as
 * attractive=5, performance=4, must-be=3, indifferent=2, reverse=1.
 * ─────────────────────────────────────────────────────────────────────
 *
 * ─── Two classification entry points ─────────────────────────────────
 * The Kano method has two well-known inputs:
 *
 *   (a) DIRECT — the agent (or product manager) has already decided the
 *       category and just wants to persist it. This is what
 *       kano-model-client.tsx does.
 *
 *   (b) FUNCTIONAL × DYSFUNCTIONAL — Kano's canonical paired-question
 *       survey: "How would you feel if this feature were PRESENT?"
 *       and "How would you feel if this feature were ABSENT?" Each is
 *       answered on a 5-point scale (like / must-be / neutral /
 *       live-with / dislike). The 5×5 answer pair maps to a category
 *       via the published Kano evaluation table (Sauerwein et al.
 *       1996), with "Q" (questionable) and "R" (reverse) outliers
 *       collapsed appropriately for our 5-bucket surface.
 *
 * Both paths produce the same { category, score } envelope, so callers
 * compose them interchangeably.
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity, serverBulkUpsertEntities } from "../server-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

const KIND_PRIORITIZATION = "workspace:prioritization";
const FRAMEWORK = "kano" as const;

/** Category ids match `kano-model-client.tsx:Category` exactly so
 *  agent-persisted items render in the correct column of the in-app
 *  grouping. See file-header comment for the rationale on naming. */
const CATEGORY_IDS = ["must-be", "performance", "attractive", "indifferent", "reverse"] as const;
type CategoryId = (typeof CATEGORY_IDS)[number];

const CategorySchema = z.enum(CATEGORY_IDS);

/** Numeric sort key for `PrioritizationItem.score`. Higher = bigger
 *  per-unit satisfaction lift. Lets a cross-framework "top of backlog"
 *  view surface Kano "attractive" features above Kano "reverse" features
 *  without anyone having to know about the category enum. The mapping
 *  matches the squad brief once the basic↔must-be and excitement↔
 *  attractive synonyms are applied. */
const SCORE_BY_CATEGORY: Record<CategoryId, number> = {
  attractive: 5, // textbook: "excitement"
  performance: 4,
  "must-be": 3, // textbook: "basic"
  indifferent: 2,
  reverse: 1,
};

/** Human-readable explanation appended to classify results. Useful for
 *  agents that want to surface a one-liner back to the user without
 *  having to know the framework internals. */
const EXPLANATION_BY_CATEGORY: Record<CategoryId, string> = {
  "must-be":
    "Must-be (textbook 'basic'): expected baseline; absence causes strong dissatisfaction, presence is taken for granted.",
  performance:
    "Performance: linear satisfaction — the more/better you deliver, the happier customers get.",
  attractive:
    "Attractive (textbook 'excitement'): delighters; presence creates outsized satisfaction, absence is not missed.",
  indifferent: "Indifferent: customers don't care either way; deprioritise.",
  reverse:
    "Reverse: presence actually causes dissatisfaction for this segment; consider removing or hiding.",
};

/** Kano survey answer scale, applied to BOTH the functional and the
 *  dysfunctional question. Names follow Sauerwein et al. (1996) /
 *  Berger et al. (1993). */
const KANO_ANSWERS = ["like", "must", "neutral", "live_with", "dislike"] as const;
type KanoAnswer = (typeof KANO_ANSWERS)[number];
const KanoAnswerSchema = z.enum(KANO_ANSWERS);

/**
 * Canonical Kano 5×5 evaluation table.
 *
 *  rows    = functional answer ("how would you feel if feature is PRESENT?")
 *  columns = dysfunctional answer ("how would you feel if feature is ABSENT?")
 *
 * Raw table from the literature uses six codes: M (must-be), O (one-
 * dimensional / performance), A (attractive), I (indifferent), R
 * (reverse), Q (questionable — usually indicates a survey error). For
 * our 5-bucket surface we collapse Q→indifferent (treat questionable
 * responses as no-signal rather than crashing) and keep R as
 * "reverse".
 *
 *               dysfunctional:
 *                like    must    neutral live_with dislike
 *  functional:
 *    like     [   Q,      A,      A,      A,        O    ]
 *    must     [   R,      I,      I,      I,        M    ]
 *    neutral  [   R,      I,      I,      I,        M    ]
 *    live_with[   R,      I,      I,      I,        M    ]
 *    dislike  [   R,      R,      R,      R,        Q    ]
 *
 * Source: Sauerwein, E., Bailom, F., Matzler, K., & Hinterhuber, H. H.
 * (1996). "The Kano model: How to delight your customers."
 */
const KANO_TABLE: Record<KanoAnswer, Record<KanoAnswer, CategoryId>> = {
  like: {
    like: "indifferent", // Q → indifferent (questionable / no-signal)
    must: "attractive",
    neutral: "attractive",
    live_with: "attractive",
    dislike: "performance",
  },
  must: {
    like: "reverse",
    must: "indifferent",
    neutral: "indifferent",
    live_with: "indifferent",
    dislike: "must-be",
  },
  neutral: {
    like: "reverse",
    must: "indifferent",
    neutral: "indifferent",
    live_with: "indifferent",
    dislike: "must-be",
  },
  live_with: {
    like: "reverse",
    must: "indifferent",
    neutral: "indifferent",
    live_with: "indifferent",
    dislike: "must-be",
  },
  dislike: {
    like: "reverse",
    must: "reverse",
    neutral: "reverse",
    live_with: "reverse",
    dislike: "indifferent", // Q → indifferent
  },
};

function nowIso(): string {
  return new Date().toISOString();
}

/** Pure classifier: either accept a direct category, or derive it from
 *  the (functional, dysfunctional) survey pair via KANO_TABLE. */
function classify(input: {
  category?: CategoryId;
  functional?: KanoAnswer;
  dysfunctional?: KanoAnswer;
}): { category: CategoryId; score: number; explanation: string } {
  let category: CategoryId;
  if (input.category) {
    category = input.category;
  } else if (input.functional && input.dysfunctional) {
    category = KANO_TABLE[input.functional][input.dysfunctional];
  } else {
    // Validated upstream by the zod refine — this branch is unreachable
    // at runtime but keeps TS happy without a non-null assertion.
    category = "indifferent";
  }
  return {
    category,
    score: SCORE_BY_CATEGORY[category],
    explanation: EXPLANATION_BY_CATEGORY[category],
  };
}

/** Shared input shape for one Kano candidate.
 *
 *  Accepts EITHER:
 *    - `category` directly (the path kano-model-client.tsx uses), OR
 *    - `functional` + `dysfunctional` survey answers (the textbook path
 *       — agents can derive a category from raw survey rows).
 *
 *  The `.refine()` enforces "at least one of these two shapes" rather
 *  than requiring both, so agents that have already classified upstream
 *  can skip the survey and the survey-driven path doesn't need to
 *  invent a placeholder category. */
const KanoFieldsSchema = z
  .object({
    category: CategorySchema.optional().describe(
      "Direct Kano category. One of: 'must-be' (textbook 'basic'), 'performance', 'attractive' (textbook 'excitement'), 'indifferent', 'reverse'. Supply this when you've already classified upstream."
    ),
    functional: KanoAnswerSchema.optional().describe(
      "Answer to 'How would you feel if this feature were PRESENT?' One of: like, must, neutral, live_with, dislike. Combined with `dysfunctional` to derive the category via the canonical Kano evaluation table."
    ),
    dysfunctional: KanoAnswerSchema.optional().describe(
      "Answer to 'How would you feel if this feature were ABSENT?' Same scale as `functional`. Required if `category` is omitted."
    ),
  })
  .refine(
    (v) =>
      v.category !== undefined || (v.functional !== undefined && v.dysfunctional !== undefined),
    {
      message:
        "Provide either `category` directly OR BOTH of (`functional`, `dysfunctional`) survey answers.",
    }
  );

const KanoItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: KanoFieldsSchema,
});

// ──────── tool.kano_model.classify ────────
// Pure: classify one feature, either from a direct category OR from a
// (functional, dysfunctional) survey pair. No persistence, no side
// effects.
registry.register({
  id: "tool.kano_model.classify",
  toolId: "tool.kano_model",
  name: "classify",
  category: "read",
  description:
    "Classify one feature into a Kano category. Accepts either a direct `category` ('must-be' | 'performance' | 'attractive' | 'indifferent' | 'reverse') OR a (`functional`, `dysfunctional`) answer pair from the canonical Kano paired-question survey — each answered on the scale like / must / neutral / live_with / dislike. Returns { category, score, explanation }. Score mapping (higher = bigger per-unit satisfaction lift): attractive=5, performance=4, must-be=3, indifferent=2, reverse=1.",
  paramsSchema: KanoFieldsSchema,
  handler: async (params) => {
    return classify(params);
  },
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.kano_model.list_items ────────
// Read-only snapshot of Kano items currently in the workspace, grouped
// by category for the agent's convenience (it's how the UI renders
// them too — see kano-model-client.tsx:85).
registry.register({
  id: "tool.kano_model.list_items",
  toolId: "tool.kano_model",
  name: "list_items",
  category: "read",
  description:
    "List all Kano-classified features in the workspace, grouped by category: { 'must-be', performance, attractive, indifferent, reverse }. Each group is sorted by recency (newest first). Filtered to framework='kano' so other prioritization frameworks (WSJF, RICE…) don't leak through.",
  paramsSchema: z.object({}),
  handler: async () => {
    const all = useWorkspaceStore.getState().prioritizations ?? [];
    return groupByCategory(all.filter((x) => x.framework === FRAMEWORK));
  },
  mcpHandler: async (_params, ctx) => {
    const all = await serverListEntities<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION);
    return groupByCategory(all.filter((x) => x.framework === FRAMEWORK));
  },
});

/** Bucket items by their persisted `fields.category`. Items with a
 *  missing or unrecognised category fall back to "performance" — same
 *  behaviour as the client (kano-model-client.tsx:107) so a board load
 *  won't crash on a stale persisted value (e.g. renamed enum from an
 *  older build). */
function groupByCategory(items: PrioritizationItem[]): {
  "must-be": PrioritizationItem[];
  performance: PrioritizationItem[];
  attractive: PrioritizationItem[];
  indifferent: PrioritizationItem[];
  reverse: PrioritizationItem[];
  total: number;
} {
  const grouped: Record<CategoryId, PrioritizationItem[]> = {
    "must-be": [],
    performance: [],
    attractive: [],
    indifferent: [],
    reverse: [],
  };
  const known = new Set<string>(CATEGORY_IDS);
  for (const it of items) {
    const raw = it.fields?.category;
    const c: CategoryId =
      typeof raw === "string" && known.has(raw) ? (raw as CategoryId) : "performance";
    grouped[c].push(it);
  }
  // Sort each bucket newest-first; ties keep insertion order (stable
  // sort). Agents fetching the list usually want "what did I just add"
  // at the top.
  for (const c of CATEGORY_IDS) {
    grouped[c].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return { ...grouped, total: items.length };
}

// ──────── tool.kano_model.classify_and_persist ────────
// Convenience: classify one feature AND save it to the workspace.
// Common agent intent: "this is a basic expectation — put it on my
// Kano board."
registry.register({
  id: "tool.kano_model.classify_and_persist",
  toolId: "tool.kano_model",
  name: "classify_and_persist",
  category: "write",
  description:
    "Classify one feature (via direct category OR (functional, dysfunctional) survey answers) and persist it to workspace.prioritization with framework='kano'. The resolved category is stored in fields.category; the numeric sort score (5/4/3/2/1 for attractive/performance/must-be/indifferent/reverse) is stored on PrioritizationItem.score. Returns { id, category, score, explanation }.",
  paramsSchema: KanoItemInputSchema,
  handler: async (params) => {
    const { category, score, explanation } = classify(params.fields);
    const item = buildItem(params.id, params.title, params.fields, category, score);
    useWorkspaceStore.getState().upsertPrioritization(item);
    return { id: item.id, category, score, explanation };
  },
  mcpHandler: async (params, ctx) => {
    const { category, score, explanation } = classify(params.fields);
    const item = buildItem(params.id, params.title, params.fields, category, score);
    await serverUpsertEntity<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, item);
    return { id: item.id, category, score, explanation };
  },
});

// ──────── tool.kano_model.persist_to_prioritization ────────
// Bulk write of pre-classified items. Each item is re-run through
// classify() so callers can mix direct-category items and survey-
// answer items in the same batch and not have to pre-resolve.
// requiresConfirmation:false because each upsert is idempotent by id
// and the agent is expected to compose this after either a classify-
// loop or an external classification step.
registry.register({
  id: "tool.kano_model.persist_to_prioritization",
  toolId: "tool.kano_model",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of Kano-classified features to workspace.prioritization. Each item supplies title + fields ({ category? , functional? , dysfunctional? }); the category + numeric sort score (5/4/3/2/1) are derived. Items without an id get one generated. Items with an existing id are overwritten (upsert by id).",
  paramsSchema: z.object({
    items: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string().min(1).max(200),
          fields: KanoFieldsSchema,
        })
      )
      .min(1)
      .max(500),
  }),
  handler: async (params) => {
    const upsert = useWorkspaceStore.getState().upsertPrioritization;
    const written: Array<{ id: string; category: CategoryId; score: number }> = [];
    for (const it of params.items) {
      const { category, score } = classify(it.fields);
      const item = buildItem(it.id, it.title, it.fields, category, score);
      upsert(item);
      written.push({ id: item.id, category, score });
    }
    return { written, count: written.length };
  },
  mcpHandler: async (params, ctx) => {
    const items: PrioritizationItem[] = [];
    const written: Array<{ id: string; category: CategoryId; score: number }> = [];
    for (const it of params.items) {
      const { category, score } = classify(it.fields);
      const item = buildItem(it.id, it.title, it.fields, category, score);
      items.push(item);
      written.push({ id: item.id, category, score });
    }
    // Single round-trip for the batch — much faster than N individual
    // upserts when the agent is loading a backlog of 50+ features.
    await serverBulkUpsertEntities<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, items);
    return { written, count: written.length };
  },
});

/** Build a PrioritizationItem with stringified survey answers (the
 *  PrioritizationItem.fields type is `Record<string, number | string>`
 *  — no enums or undefineds allowed in the storage shape). The
 *  resolved category goes in as a plain string so the client's switch
 *  at kano-model-client.tsx:107 reads it cleanly. */
function buildItem(
  explicitId: string | undefined,
  title: string,
  fields: { category?: CategoryId; functional?: KanoAnswer; dysfunctional?: KanoAnswer },
  category: CategoryId,
  score: number
): PrioritizationItem {
  const storedFields: Record<string, number | string> = { category };
  if (fields.functional) storedFields.functional = fields.functional;
  if (fields.dysfunctional) storedFields.dysfunctional = fields.dysfunctional;
  return {
    id: explicitId ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
    framework: FRAMEWORK,
    title: title.slice(0, 200),
    score,
    fields: storedFields,
    status: "scored",
    updatedAt: nowIso(),
  };
}
