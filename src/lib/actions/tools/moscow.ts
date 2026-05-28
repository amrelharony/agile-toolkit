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
 * dashboards: must=4, should=3, could=2, wont=1. That lets a
 * "top of backlog" view rank MUST items above WONT items without anyone
 * having to know about the MoSCoW enum.
 *
 * ─── Category-id alignment with the client (moscow-client.tsx) ────────
 * The in-app client persists `fields.bucket` (NOT `category`) as one of
 * "must" | "should" | "could" | "wont" — its `Bucket` type at line 25.
 * To keep agent writes and UI writes roundtrip-compatible (an agent
 * persisting a scope item should render in the right bucket without the
 * client's fallback at line 80 silently coercing it to "must"), we use
 * the CLIENT's field key (`bucket`) and machine-friendly snake_case
 * values ("must" / "should" / "could" / "wont"). The agent-facing
 * surface still uses "category" as the param name (per the squad brief),
 * but it maps to `fields.bucket` on the way to storage.
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity, serverBulkUpsertEntities } from "../server-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

const KIND_PRIORITIZATION = "workspace:prioritization";
const FRAMEWORK = "moscow" as const;

/** Category ids match `moscow-client.tsx:Bucket` exactly so agent-
 *  persisted items render in the correct column of the in-app matrix.
 *  See file-header comment for the rationale. */
const CATEGORY_IDS = ["must", "should", "could", "wont"] as const;
type CategoryId = (typeof CATEGORY_IDS)[number];

const CategorySchema = z.enum(CATEGORY_IDS);

/** Numeric sort key for `PrioritizationItem.score`. Higher = higher
 *  priority. Lets a cross-framework "top of backlog" view surface
 *  MoSCoW "must" items above MoSCoW "wont" items without anyone having
 *  to know about the category enum. */
const SCORE_BY_CATEGORY: Record<CategoryId, number> = {
  must: 4,
  should: 3,
  could: 2,
  wont: 1,
};

/** Human-readable descriptions for the classify response — agents (and
 *  humans reading agent transcripts) get the long-form intent without
 *  having to look it up. */
const DESCRIPTION_BY_CATEGORY: Record<CategoryId, string> = {
  must: "Must have — non-negotiable scope; release fails without it.",
  should: "Should have — important but not vital; can be deferred with workaround.",
  could: "Could have — desirable nice-to-haves; included only if time permits.",
  wont: "Won't have (this time) — explicitly out of scope for the current release.",
};

function nowIso(): string {
  return new Date().toISOString();
}

/** Pure classifier: category → priority sort score + description. */
function classify(category: CategoryId): {
  category: CategoryId;
  priority: number;
  description: string;
} {
  return {
    category,
    priority: SCORE_BY_CATEGORY[category],
    description: DESCRIPTION_BY_CATEGORY[category],
  };
}

const MoscowFieldsSchema = z.object({
  category: CategorySchema.describe(
    "MoSCoW bucket: 'must' (non-negotiable), 'should' (important not vital), 'could' (nice-to-have), 'wont' (out of scope this release)"
  ),
});

const MoscowItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: MoscowFieldsSchema,
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
// Read-only snapshot of MoSCoW items currently in the workspace,
// grouped by category for the agent's convenience (it's how the UI
// renders them too).
registry.register({
  id: "tool.moscow.list_items",
  toolId: "tool.moscow",
  name: "list_items",
  category: "read",
  description:
    "List all MoSCoW-classified scope items in the workspace, grouped by category: { must, should, could, wont }. Each group is sorted by recency (newest first). Filtered to framework='moscow' so other prioritization frameworks (WSJF, RICE…) don't leak through.",
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

/** Bucket items by their persisted `fields.bucket`. Items with a
 *  missing or unrecognised category fall back to "must" — same
 *  behaviour as the client (moscow-client.tsx:80) so a board load won't
 *  crash on a stale persisted value. */
function groupByCategory(items: PrioritizationItem[]): {
  must: PrioritizationItem[];
  should: PrioritizationItem[];
  could: PrioritizationItem[];
  wont: PrioritizationItem[];
  total: number;
} {
  const grouped: Record<CategoryId, PrioritizationItem[]> = {
    must: [],
    should: [],
    could: [],
    wont: [],
  };
  for (const it of items) {
    const raw = it.fields?.bucket;
    const c: CategoryId = raw === "should" || raw === "could" || raw === "wont" ? raw : "must";
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

// ──────── tool.moscow.classify_and_persist ────────
// Convenience: classify one scope item AND save it to the workspace.
// Common agent intent: "this is a must-have — put it on the matrix."
registry.register({
  id: "tool.moscow.classify_and_persist",
  toolId: "tool.moscow",
  name: "classify_and_persist",
  category: "write",
  description:
    "Classify one scope item by MoSCoW category and persist it to workspace.prioritization with framework='moscow'. The category is stored in fields.bucket; the numeric priority (4/3/2/1 for must/should/could/wont) is stored on PrioritizationItem.score for cross-framework sorting. Returns { id, category, priority }.",
  paramsSchema: MoscowItemInputSchema,
  handler: async (params) => {
    const { category, priority } = classify(params.fields.category);
    const item = buildItem(params.id, params.title, category, priority);
    useWorkspaceStore.getState().upsertPrioritization(item);
    return { id: item.id, category, priority };
  },
  mcpHandler: async (params, ctx) => {
    const { category, priority } = classify(params.fields.category);
    const item = buildItem(params.id, params.title, category, priority);
    await serverUpsertEntity<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, item);
    return { id: item.id, category, priority };
  },
});

// ──────── tool.moscow.persist_to_prioritization ────────
// Bulk write of pre-classified items. requiresConfirmation:false
// because each upsert is idempotent by id and the agent is expected to
// compose this after a classify-loop.
registry.register({
  id: "tool.moscow.persist_to_prioritization",
  toolId: "tool.moscow",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of MoSCoW-classified scope items to workspace.prioritization. Each item supplies title + fields ({ category }); the numeric priority sort score (4/3/2/1) is derived. Items without an id get one generated. Items with an existing id are overwritten (upsert by id).",
  paramsSchema: z.object({
    items: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string().min(1).max(200),
          fields: MoscowFieldsSchema,
        })
      )
      .min(1)
      .max(500),
  }),
  handler: async (params) => {
    const upsert = useWorkspaceStore.getState().upsertPrioritization;
    const written: Array<{ id: string; category: CategoryId; priority: number }> = [];
    for (const it of params.items) {
      const { category, priority } = classify(it.fields.category);
      const item = buildItem(it.id, it.title, category, priority);
      upsert(item);
      written.push({ id: item.id, category, priority });
    }
    return { written, count: written.length };
  },
  mcpHandler: async (params, ctx) => {
    const items: PrioritizationItem[] = [];
    const written: Array<{ id: string; category: CategoryId; priority: number }> = [];
    for (const it of params.items) {
      const { category, priority } = classify(it.fields.category);
      const item = buildItem(it.id, it.title, category, priority);
      items.push(item);
      written.push({ id: item.id, category, priority });
    }
    // Single round-trip for the batch — much faster than N individual
    // upserts when the agent is loading a backlog of 50+ items.
    await serverBulkUpsertEntities<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, items);
    return { written, count: written.length };
  },
});

/** Build a PrioritizationItem with the category in `fields.bucket` (the
 *  field key the in-app client reads from at moscow-client.tsx:78). The
 *  PrioritizationItem.fields type is `Record<string, number | string>`
 *  so the category goes in as a plain string, NOT a typed enum. */
function buildItem(
  explicitId: string | undefined,
  title: string,
  category: CategoryId,
  priority: number
): PrioritizationItem {
  return {
    id: explicitId ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
    framework: FRAMEWORK,
    title: title.slice(0, 200),
    score: priority,
    fields: {
      bucket: category,
    },
    status: "scored",
    updatedAt: nowIso(),
  };
}
