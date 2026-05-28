/**
 * Eisenhower Matrix — tool-local actions.
 *
 * Category: Prioritization Frameworks (squad S13)
 * Tool:     Urgent × Important 2x2 classifier (Do / Schedule / Delegate / Delete)
 *
 * Agent surface: tool.eisenhower.*
 * Backing CRUD : workspace.prioritization.* (auto-generated, shared with
 *                wsjf, ice-score, rice, moscow, kano-model,
 *                cost-of-delay, weighted-decision)
 *
 * ─── CLASSIFIER variant of the calc-tool pattern ─────────────────────
 * WSJF and friends compute a numeric score from numeric inputs. The
 * Eisenhower Matrix is different: inputs are two booleans (urgent? +
 * important?) and the output is a discrete quadrant label. We still
 * surface a numeric `score` (4 / 3 / 2 / 1 for do / schedule /
 * delegate / delete) so the shared `PrioritizationItem.score` sort
 * column produces a sensible order ("most-urgent + most-important on
 * top, throw-aways at the bottom"). This lets `list_scored` cross-tool
 * dashboards rank an Eisenhower task next to a WSJF task without
 * special-casing.
 *
 * ─── Quadrant-id divergence (eisenhower-client.tsx vs the task spec) ─
 * The in-app client (src/app/(tools)/eisenhower/eisenhower-client.tsx)
 * persists `fields.quadrant` as one of: "do" | "schedule" | "delegate"
 * | "delete" — its `Quadrant` type at the top of the file. The squad
 * brief suggested "do_first" for the urgent+important quadrant. To
 * keep agent writes and UI writes roundtrip-compatible (an agent
 * persisting a task should land in the right column without the
 * client's fallback hack at line 84 silently coercing it back to
 * "do"), we adopt the CLIENT's vocabulary: "do" / "schedule" /
 * "delegate" / "delete". The descriptive long-form names ("Do First",
 * etc.) appear in the description strings so the agent still
 * understands the intent.
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity, serverBulkUpsertEntities } from "../server-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

const KIND_PRIORITIZATION = "workspace:prioritization";
const FRAMEWORK = "eisenhower" as const;

/** Quadrant ids match `eisenhower-client.tsx:Quadrant` exactly so
 *  agent-persisted items render in the correct column of the in-app
 *  matrix. See file-header comment for the rationale. */
const QUADRANT_IDS = ["do", "schedule", "delegate", "delete"] as const;
type QuadrantId = (typeof QUADRANT_IDS)[number];

const QuadrantSchema = z.enum(QUADRANT_IDS);

/** Numeric sort key for `PrioritizationItem.score`. Higher = more
 *  urgent + important. Lets a cross-framework "top of backlog" view
 *  surface Eisenhower "Do" tasks above Eisenhower "Delete" tasks
 *  without anyone having to know about the quadrant enum. */
const SCORE_BY_QUADRANT: Record<QuadrantId, number> = {
  do: 4,
  schedule: 3,
  delegate: 2,
  delete: 1,
};

function nowIso(): string {
  return new Date().toISOString();
}

/** Pure classifier: (urgent, important) → quadrant + sort score. */
function classify(urgent: boolean, important: boolean): { quadrant: QuadrantId; score: number } {
  let quadrant: QuadrantId;
  if (urgent && important) quadrant = "do";
  else if (!urgent && important) quadrant = "schedule";
  else if (urgent && !important) quadrant = "delegate";
  else quadrant = "delete";
  return { quadrant, score: SCORE_BY_QUADRANT[quadrant] };
}

/** Shared input shape for one Eisenhower candidate. */
const EisenhowerFieldsSchema = z.object({
  urgent: z.boolean().describe("Is the task time-sensitive / does delay incur a real cost?"),
  important: z
    .boolean()
    .describe("Does the task move a meaningful goal forward (vs. just feel busy)?"),
});

const EisenhowerItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: EisenhowerFieldsSchema,
});

// ──────── tool.eisenhower.classify ────────
// Pure: classify one (urgent, important) pair into a quadrant. No
// persistence, no side effects.
registry.register({
  id: "tool.eisenhower.classify",
  toolId: "tool.eisenhower",
  name: "classify",
  category: "read",
  description:
    "Classify one task by (urgent, important) into the Eisenhower quadrant: 'do' (urgent+important), 'schedule' (important, not urgent), 'delegate' (urgent, not important), 'delete' (neither). Returns the quadrant id and a numeric score (4/3/2/1 respectively) for cross-framework sorting.",
  paramsSchema: EisenhowerFieldsSchema,
  handler: async (params) => {
    const { quadrant, score } = classify(params.urgent, params.important);
    return {
      quadrant,
      score,
      rule: "do = U+I, schedule = ¬U+I, delegate = U+¬I, delete = ¬U+¬I",
    };
  },
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.eisenhower.list_items ────────
// Read-only snapshot of Eisenhower items currently in the workspace,
// grouped by quadrant for the agent's convenience (it's how the UI
// renders them too).
registry.register({
  id: "tool.eisenhower.list_items",
  toolId: "tool.eisenhower",
  name: "list_items",
  category: "read",
  description:
    "List all Eisenhower-classified tasks in the workspace, grouped by quadrant: { do, schedule, delegate, delete }. Each group is sorted by recency (newest first). Filtered to framework='eisenhower' so other prioritization frameworks (WSJF, RICE…) don't leak through.",
  paramsSchema: z.object({}),
  handler: async () => {
    const all = useWorkspaceStore.getState().prioritizations ?? [];
    return groupByQuadrant(all.filter((x) => x.framework === FRAMEWORK));
  },
  mcpHandler: async (_params, ctx) => {
    const all = await serverListEntities<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION);
    return groupByQuadrant(all.filter((x) => x.framework === FRAMEWORK));
  },
});

/** Bucket items by their persisted `fields.quadrant`. Items with a
 *  missing or unrecognised quadrant fall back to "do" — same behaviour
 *  as the client (eisenhower-client.tsx:84) so a board load won't crash
 *  on a stale persisted value. */
function groupByQuadrant(items: PrioritizationItem[]): {
  do: PrioritizationItem[];
  schedule: PrioritizationItem[];
  delegate: PrioritizationItem[];
  delete: PrioritizationItem[];
  total: number;
} {
  const grouped: Record<QuadrantId, PrioritizationItem[]> = {
    do: [],
    schedule: [],
    delegate: [],
    delete: [],
  };
  for (const it of items) {
    const raw = it.fields?.quadrant;
    const q: QuadrantId = raw === "schedule" || raw === "delegate" || raw === "delete" ? raw : "do";
    grouped[q].push(it);
  }
  // Sort each bucket newest-first; ties keep insertion order (stable
  // sort). Agents fetching the list usually want "what did I just add"
  // at the top.
  for (const q of QUADRANT_IDS) {
    grouped[q].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return { ...grouped, total: items.length };
}

// ──────── tool.eisenhower.classify_and_persist ────────
// Convenience: classify one task AND save it to the workspace.
// Common agent intent: "this is urgent and important — put it on my
// matrix."
registry.register({
  id: "tool.eisenhower.classify_and_persist",
  toolId: "tool.eisenhower",
  name: "classify_and_persist",
  category: "write",
  description:
    "Classify one task by (urgent, important) and persist it to workspace.prioritization with framework='eisenhower'. The resolved quadrant is stored in fields.quadrant; the numeric sort score (4/3/2/1) is stored on PrioritizationItem.score. Returns { id, quadrant, score }.",
  paramsSchema: EisenhowerItemInputSchema,
  handler: async (params) => {
    const { quadrant, score } = classify(params.fields.urgent, params.fields.important);
    const item = buildItem(params.id, params.title, params.fields, quadrant, score);
    useWorkspaceStore.getState().upsertPrioritization(item);
    return { id: item.id, quadrant, score };
  },
  mcpHandler: async (params, ctx) => {
    const { quadrant, score } = classify(params.fields.urgent, params.fields.important);
    const item = buildItem(params.id, params.title, params.fields, quadrant, score);
    await serverUpsertEntity<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, item);
    return { id: item.id, quadrant, score };
  },
});

// ──────── tool.eisenhower.persist_to_prioritization ────────
// Bulk write of pre-classified items. Items can either:
//   (a) provide `quadrant` directly (agent already decided), OR
//   (b) provide `urgent` + `important` in fields and let this action
//       re-classify.
// requiresConfirmation:false because each upsert is idempotent by id
// and the agent is expected to compose this after either a
// classify-loop or an external classification step.
registry.register({
  id: "tool.eisenhower.persist_to_prioritization",
  toolId: "tool.eisenhower",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of Eisenhower-classified tasks to workspace.prioritization. Each item supplies title + fields ({ urgent, important }); the quadrant + numeric sort score (4/3/2/1) are derived. Items without an id get one generated. Items with an existing id are overwritten (upsert by id).",
  paramsSchema: z.object({
    items: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string().min(1).max(200),
          fields: EisenhowerFieldsSchema,
          /** Optional explicit override — when present, skips the
           *  classify() step and writes this quadrant directly. Used
           *  when the agent has already classified upstream and just
           *  wants a bulk-persist. */
          quadrant: QuadrantSchema.optional(),
        })
      )
      .min(1)
      .max(500),
  }),
  handler: async (params) => {
    const upsert = useWorkspaceStore.getState().upsertPrioritization;
    const written: Array<{ id: string; quadrant: QuadrantId; score: number }> = [];
    for (const it of params.items) {
      const { quadrant, score } = it.quadrant
        ? { quadrant: it.quadrant, score: SCORE_BY_QUADRANT[it.quadrant] }
        : classify(it.fields.urgent, it.fields.important);
      const item = buildItem(it.id, it.title, it.fields, quadrant, score);
      upsert(item);
      written.push({ id: item.id, quadrant, score });
    }
    return { written, count: written.length };
  },
  mcpHandler: async (params, ctx) => {
    const items: PrioritizationItem[] = [];
    const written: Array<{ id: string; quadrant: QuadrantId; score: number }> = [];
    for (const it of params.items) {
      const { quadrant, score } = it.quadrant
        ? { quadrant: it.quadrant, score: SCORE_BY_QUADRANT[it.quadrant] }
        : classify(it.fields.urgent, it.fields.important);
      const item = buildItem(it.id, it.title, it.fields, quadrant, score);
      items.push(item);
      written.push({ id: item.id, quadrant, score });
    }
    // Single round-trip for the batch — much faster than N individual
    // upserts when the agent is loading a backlog of 50+ items.
    await serverBulkUpsertEntities<PrioritizationItem>(ctx.userId, KIND_PRIORITIZATION, items);
    return { written, count: written.length };
  },
});

/** Build a PrioritizationItem with stringified booleans (the
 *  PrioritizationItem.fields type is `Record<string, number | string>`
 *  — no booleans allowed in the storage shape). The quadrant goes in
 *  as a plain string so the client's switch at line 84 reads it
 *  cleanly. */
function buildItem(
  explicitId: string | undefined,
  title: string,
  fields: { urgent: boolean; important: boolean },
  quadrant: QuadrantId,
  score: number
): PrioritizationItem {
  return {
    id: explicitId ?? `prio_${Math.random().toString(36).slice(2, 10)}`,
    framework: FRAMEWORK,
    title: title.slice(0, 200),
    score,
    fields: {
      urgent: String(fields.urgent),
      important: String(fields.important),
      quadrant,
    },
    status: "scored",
    updatedAt: nowIso(),
  };
}
