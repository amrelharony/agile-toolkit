/**
 * MoSCoW Matrix — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     Must / Should / Could / Won't scope classifier
 *
 * Agent surface: tool.moscow.*
 * Backing CRUD : workspace.prioritization.* (auto-generated, shared with
 *                wsjf, ice-score, rice, eisenhower, kano-model,
 *                cost-of-delay, weighted-decision)
 *
 * ─── CLASSIFIER variant of the calc-tool pattern ─────────────────────
 * Like Eisenhower, MoSCoW is a discrete-bucket classifier (not a
 * numeric scorer). The input is a category label and the output is the
 * same label echoed back with a numeric sort score for cross-framework
 * dashboards: must=4, should=3, could=2, wont=1 (the page stores the same
 * score). That lets a "top of backlog" view rank MUST items above WONT
 * items without anyone having to know about the MoSCoW enum.
 *
 * ─── Category-id alignment with the page ──────────────────────────────
 * Rows keep the bucket in `fields.bucket` as "must" | "should" | "could" |
 * "wont", the key the page reads. The agent-facing surface still uses
 * "category" as the param name, mapped to `fields.bucket` on the way to
 * storage.
 *
 * There is no default bucket anywhere: a row with a missing or unknown
 * bucket lists under `unsorted` ("Not sorted yet"), never under Must. The
 * bucket comes from the method registry (lib/prioritization/methods/moscow);
 * a row linked to a backlog item reads its bucket from the item, and a
 * persist with `backlogItemId` writes the bucket to the item.
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { linkedItem } from "@/lib/prioritization/binding";
import { method, readThrough, withoutLegacyMark, type Values } from "@/lib/prioritization/methods";
import {
  MOSCOW_BUCKETS,
  MOSCOW_MEANING,
  MOSCOW_PRIORITY,
  MUST_BUDGET_SHARE,
  moscowEffort,
  mustBudget,
  type MoscowBucket,
} from "@/lib/prioritization/methods/moscow";
import { toChoice } from "@/lib/prioritization/methods/fields";
import { clientStore, persistMethodRows, serverStore, type MethodStore } from "./_method-rows";

const FRAMEWORK = "moscow" as const;
const MOSCOW = method(FRAMEWORK);

type CategoryId = MoscowBucket;

const CategorySchema = z.enum(MOSCOW_BUCKETS);

/** Long-form descriptions for the classify response (the page's meanings). */
const DESCRIPTION_BY_CATEGORY: Record<CategoryId, string> = {
  must: `Must have — ${MOSCOW_MEANING.must}`,
  should: `Should have — ${MOSCOW_MEANING.should}`,
  could: `Could have — ${MOSCOW_MEANING.could}`,
  wont: `Won't have (this time) — ${MOSCOW_MEANING.wont}`,
};

/** Pure classifier: category → priority sort score + description. */
function classify(category: CategoryId): {
  category: CategoryId;
  priority: number;
  description: string;
} {
  return {
    category,
    priority: MOSCOW_PRIORITY[category],
    description: DESCRIPTION_BY_CATEGORY[category],
  };
}

const MoscowFieldsSchema = z.object({
  category: CategorySchema.describe(
    "MoSCoW bucket: 'must' (non-negotiable), 'should' (important not vital), 'could' (nice-to-have), 'wont' (out of scope this release). Required: there is no default."
  ),
  effort: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Optional effort for the Must budget, for an item not on the backlog (a linked item's WSJF job size counts instead)"
    ),
});

/** What a persist takes: an effort left out stays as the row has it, null clears it. */
const MoscowPersistFieldsSchema = MoscowFieldsSchema.extend({
  effort: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe(
      "Optional effort for the Must budget, for an item not on the backlog (a linked item's WSJF job size counts instead). Left out, an existing row keeps its effort; null clears it."
    ),
});

type MoscowPersistFields = z.infer<typeof MoscowPersistFieldsSchema>;

const MoscowItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: MoscowPersistFieldsSchema,
  backlogItemId: z
    .string()
    .optional()
    .describe("Link the row to this backlog item; its MoSCoW bucket is written to the item"),
});

/** The input a persist may leave out that an existing row keeps. */
const KEEP = ["effort"];

/** A persist item as the method's inputs: an effort of null is a clear. */
const persistInput = (it: {
  id?: string;
  title: string;
  fields: MoscowPersistFields;
  backlogItemId?: string;
}) => ({
  id: it.id,
  title: it.title,
  values: { bucket: it.fields.category, effort: it.fields.effort ?? undefined } as Values,
  backlogItemId: it.backlogItemId,
  cleared: it.fields.effort === null ? ["effort"] : [],
});

// ──────── tool.moscow.classify ────────
// Pure: echo back the category with its numeric priority + description.
// Trivial by design — MoSCoW classification is a human/agent judgement
// call, not a derived rule. This action exists so agents can introspect
// the {category → priority} mapping without round-tripping through the
// store.
registry.register({
  id: "tool.moscow.classify",
  toolId: "tool.moscow",
  name: "classify",
  category: "read",
  description:
    "Classify a scope item by MoSCoW category. Input is one of 'must' | 'should' | 'could' | 'wont' and returns the same category plus a numeric priority (must=4, should=3, could=2, wont=1) for cross-framework sorting, and a short description of what the category means.",
  paramsSchema: MoscowFieldsSchema,
  handler: async (params) => {
    return classify(params.category);
  },
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.moscow.list_items ────────
// Read-only snapshot of MoSCoW items currently in the workspace, grouped
// by bucket (it's how the page renders them), with the Must budget.

/** A listed row: its fields as scored (a linked row's bucket from its item). */
type ListedMoscowRow = PrioritizationItem & { backlogItemId?: string };

/**
 * Bucket rows by their bucket, read through to a linked item; a missing or
 * unknown bucket lists under `unsorted`, never under Must. Each bucket is
 * newest first. `budget` is the Must budget: Musts should take at most
 * about 60% of the planned (Must + Should + Could) effort; the share shows
 * from 3 sized items.
 */
function groupByCategory(rows: readonly PrioritizationItem[], items: readonly BacklogItem[]) {
  const grouped: Record<CategoryId | "unsorted", ListedMoscowRow[]> = {
    must: [],
    should: [],
    could: [],
    wont: [],
    unsorted: [],
  };
  const entries: { bucket: CategoryId | null; effort: number | null }[] = [];
  for (const row of rows) {
    const item = linkedItem(row, items);
    const fields = readThrough(row, item);
    const bucket = toChoice(MOSCOW_BUCKETS, MOSCOW.read(fields).bucket) ?? null;
    // The legacy mark is bookkeeping, not a field (as the page's export).
    grouped[bucket ?? "unsorted"].push({ ...row, fields: withoutLegacyMark(fields) });
    entries.push({ bucket, effort: moscowEffort(fields, item) });
  }
  // Sort each bucket newest-first; ties keep insertion order (stable
  // sort). Agents fetching the list usually want "what did I just add"
  // at the top.
  for (const c of [...MOSCOW_BUCKETS, "unsorted"] as const) {
    grouped[c].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  // Musts with no effort are left out of the share, so while any is, the
  // share is a floor (the page never calls it inside the limit then).
  const unsizedMusts = entries.filter(
    (e) => e.bucket === "must" && (e.effort === null || !Number.isFinite(e.effort) || e.effort < 0)
  ).length;
  return {
    ...grouped,
    total: rows.length,
    budget: { ...mustBudget(entries), unsizedMusts, limit: MUST_BUDGET_SHARE },
  };
}

const listItems = async (store: MethodStore) => {
  const [all, items] = await Promise.all([store.rows(), store.items()]);
  return groupByCategory(
    all.filter((x) => x.framework === FRAMEWORK),
    items
  );
};

registry.register({
  id: "tool.moscow.list_items",
  toolId: "tool.moscow",
  name: "list_items",
  category: "read",
  description:
    "List all MoSCoW-classified scope items in the workspace, grouped by category: { must, should, could, wont, unsorted, total, budget }. The groups hold the stored rows (not the {values, score, rank} rows other methods list): the bucket is fields.bucket, and a row linked to a backlog item takes it from the item, while fields.effort is the row's own; one with no (or an unknown) bucket is under unsorted, never Must. Each group is sorted by recency (newest first). budget = { mustEffort, plannedEffort, share, over, excess, sized, unsized, unsizedMusts, limit }: Musts should take at most about 60% of the Must+Should+Could effort (a linked item's job size, else the row's effort); share is null below 3 sized items. unsizedMusts counts the Musts with no effort: they're left out of the share, so while it's above 0 the share is a lower bound (with every Must unsized it can't be judged at all). Filtered to framework='moscow' so other prioritization frameworks (WSJF, RICE…) don't leak through.",
  paramsSchema: z.object({}),
  handler: async () => listItems(clientStore()),
  mcpHandler: async (_params, ctx) => listItems(serverStore(ctx.userId)),
});

// ──────── tool.moscow.classify_and_persist ────────
// Convenience: classify one scope item AND save it to the workspace.
// Common agent intent: "this is a must-have — put it on the matrix."
const classifyAndPersist = async (
  store: MethodStore,
  params: z.infer<typeof MoscowItemInputSchema>
) => {
  const [saved] = await persistMethodRows(store, FRAMEWORK, [persistInput(params)], {
    keep: KEEP,
  });
  return {
    id: saved.row.id,
    category: params.fields.category,
    priority: MOSCOW_PRIORITY[params.fields.category],
    backlogItemId: saved.backlogItemId,
    backlogUpdated: saved.backlogUpdated,
  };
};

registry.register({
  id: "tool.moscow.classify_and_persist",
  toolId: "tool.moscow",
  name: "classify_and_persist",
  category: "write",
  description:
    "Classify one scope item by MoSCoW category and persist it to workspace.prioritization with framework='moscow'. The category is stored in fields.bucket; the numeric priority (4/3/2/1 for must/should/could/wont) is stored on PrioritizationItem.score for cross-framework sorting. An existing id keeps its other fields (its effort too, unless given; effort: null clears it) and its backlog link; backlogItemId links the row and writes the bucket to that backlog item. Returns { id, category, priority, backlogItemId, backlogUpdated }.",
  paramsSchema: MoscowItemInputSchema,
  handler: async (params) => classifyAndPersist(clientStore(), params),
  mcpHandler: async (params, ctx) => classifyAndPersist(serverStore(ctx.userId), params),
});

// ──────── tool.moscow.persist_to_prioritization ────────
// Bulk write of pre-classified items. requiresConfirmation:false
// because each upsert is idempotent by id and the agent is expected to
// compose this after a classify-loop.
const PersistSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1).max(200),
        fields: MoscowPersistFieldsSchema,
        backlogItemId: z.string().optional().describe("Link the row to this backlog item"),
      })
    )
    .min(1)
    .max(500),
});

const persistAll = async (store: MethodStore, params: z.infer<typeof PersistSchema>) => {
  const saved = await persistMethodRows(store, FRAMEWORK, params.items.map(persistInput), {
    keep: KEEP,
  });
  const written = saved.map((s, i) => ({
    id: s.row.id,
    category: params.items[i].fields.category,
    priority: MOSCOW_PRIORITY[params.items[i].fields.category],
  }));
  return { written, count: written.length };
};

registry.register({
  id: "tool.moscow.persist_to_prioritization",
  toolId: "tool.moscow",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of MoSCoW-classified scope items to workspace.prioritization. Each item supplies title + fields ({ category, effort? }); the numeric priority sort score (4/3/2/1) is derived. Items without an id get one generated; an existing id is updated in place, keeping its other fields (its effort too, unless given; effort: null clears it) and backlog link.",
  paramsSchema: PersistSchema,
  handler: async (params) => persistAll(clientStore(), params),
  mcpHandler: async (params, ctx) => persistAll(serverStore(ctx.userId), params),
});
