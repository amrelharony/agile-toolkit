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
 * places each item in one of four quadrants:
 *
 *   • Quick Wins    — HIGH value, LOW  effort (do these first)
 *   • Big Bets      — HIGH value, HIGH effort (strategic investments)
 *   • Fill-Ins      — LOW  value, LOW  effort (do if capacity allows)
 *   • Time Wasters  — LOW  value, HIGH effort (avoid)
 *
 * One rule everywhere (the page, the Prioritizer and these actions), from
 * the method registry (lib/prioritization/methods/value-effort):
 * - value is the backlog's one value field, on the Fibonacci scale
 *   1, 2, 3, 5, 8, 13, 20; 8 or more is HIGH;
 * - effort is 1–10; 6 or more is HIGH;
 * - the quadrant is derived, never stored: rows keep only value and effort
 *   (a stored `quadrant` from before is ignored);
 * - the sort score (PrioritizationItem.score) is value ÷ effort, and lists
 *   go quadrant by quadrant in do-first order. `quadrantScore` (4..1) is
 *   still returned for callers that sorted by it.
 * A row linked to a backlog item reads value and effort from the item, and
 * a write with `backlogItemId` (or to a linked row) writes them to it.
 */

import { z } from "zod";
import { registry } from "../registry";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import {
  applyItemPatch,
  clearedKeys,
  itemPatchChanges,
  methodRow,
  ownedPatch,
} from "@/lib/prioritization/binding";
import { savedByEngine } from "@/lib/prioritization/defaults";
import {
  markLegacyDifferences,
  method,
  readThrough,
  withLegacyLinks,
  type Values,
} from "@/lib/prioritization/methods";
import { FIBONACCI_VALUES } from "@/lib/prioritization/methods/fibonacci";
import {
  VE_HIGH_EFFORT_FROM,
  VE_HIGH_VALUE_FROM,
  VE_QUADRANTS,
  veQuadrant,
  type ValueEffortQuadrant,
} from "@/lib/prioritization/methods/value-effort";
import { rankMethodRows } from "@/lib/prioritization/rank";
import {
  candidateId,
  clientStore,
  persistMethodRows,
  serverStore,
  type MethodStore,
  type PersistInput,
} from "./_method-rows";

const FRAMEWORK = "value-effort" as const;
const VALUE_EFFORT = method(FRAMEWORK);

/** Snake_case quadrant keys used in the agent-facing API and the page alike. */
export type Quadrant = ValueEffortQuadrant;

/** A 4..1 quadrant rank (Quick Wins = 4 … Time Wasters = 1), for callers that sort by it. */
const QUADRANT_SCORE: Record<Quadrant, number> = {
  quick_wins: 4,
  big_bets: 3,
  fill_ins: 2,
  time_wasters: 1,
};

/** The one rule's boundaries, returned where the old per-call thresholds were. */
const THRESHOLDS = { value: VE_HIGH_VALUE_FROM, effort: VE_HIGH_EFFORT_FROM } as const;

/** The quadrant of a value and an effort (one rule: value 8+, effort 6+ is high). */
export function classifyQuadrant(value: number, effort: number): Quadrant | null {
  return veQuadrant(value, effort);
}

const FIB_LIST = FIBONACCI_VALUES.join(", ");
// The scale is checked by the method's validate on every write, the rule
// WSJF's business value follows too (it is the same field): a new value is
// a step, a value the row or item already holds may stay. A pure compute
// places any number.
const ValueSchema = z
  .number()
  .describe(
    `Value on the backlog's Fibonacci scale ${FIB_LIST}, relative to the other items; ${VE_HIGH_VALUE_FROM} or more is high. It is the same field as WSJF's business value. A write refuses a value off the scale unless the item already holds it.`
  );
const EffortSchema = z
  .number()
  .min(1)
  .max(10)
  .describe(
    `Effort, 1 (under a day) to 10 (months across teams); ${VE_HIGH_EFFORT_FROM} or more is high.`
  );

/** Shared input shape for one Value/Effort candidate. */
const VEFieldsSchema = z.object({ value: ValueSchema, effort: EffortSchema });

const DeprecatedThreshold = z
  .number()
  .min(0)
  .optional()
  .describe(
    `Deprecated and ignored: one rule everywhere (value ${VE_HIGH_VALUE_FROM}+ on the Fibonacci scale, effort ${VE_HIGH_EFFORT_FROM}+ on 1-10 is high).`
  );

const VEItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: VEFieldsSchema,
  backlogItemId: z
    .string()
    .optional()
    .describe(
      "Link the row to this backlog item; value and effort are written to the item (businessValue, matrixEffort)"
    ),
});

const valuesOf = (f: { value?: number; effort?: number } | undefined): Values => ({
  value: f?.value,
  effort: f?.effort,
});

/** The placement of one value/effort pair: quadrant, sort score and the 4..1 rank. */
function place(v: Values) {
  const r = VALUE_EFFORT.evaluate(v);
  const quadrant = (r.bucket as Quadrant | null) ?? null;
  return {
    quadrant,
    score: r.score,
    quadrantScore: quadrant ? QUADRANT_SCORE[quadrant] : null,
    missing: r.missing,
  };
}

// ──────── tool.value_effort_matrix.compute_quadrant ────────
// Pure: classify one (value, effort) pair into its quadrant.
registry.register({
  id: "tool.value_effort_matrix.compute_quadrant",
  toolId: "tool.value_effort_matrix",
  name: "compute_quadrant",
  category: "read",
  description: `Classify a single item into one of four quadrants (quick_wins, big_bets, fill_ins, time_wasters) by value vs effort, as the page and the Prioritizer do: value on the Fibonacci scale (${FIB_LIST}; ${VE_HIGH_VALUE_FROM}+ is high) and effort 1-10 (${VE_HIGH_EFFORT_FROM}+ is high). Returns {quadrant, score (value ÷ effort), quadrantScore (Quick Wins=4 … Time Wasters=1), thresholds}.`,
  paramsSchema: VEFieldsSchema.extend({
    valueThreshold: DeprecatedThreshold,
    effortThreshold: DeprecatedThreshold,
  }),
  handler: async (params) => ({ ...place(valuesOf(params)), thresholds: THRESHOLDS }),
  // No mcpHandler — pure classification runs identically on server and client.
});

// ──────── tool.value_effort_matrix.compute_and_rank ────────
// Pure batch: classify many candidates, quadrant by quadrant in do-first order.
registry.register({
  id: "tool.value_effort_matrix.compute_and_rank",
  toolId: "tool.value_effort_matrix",
  name: "compute_and_rank",
  category: "read",
  description:
    "Classify a batch of items into value/effort quadrants and return them in do-first order: Quick Wins, Big Bets, Fill-Ins, Time Wasters, and by value ÷ effort within each. Pure — no persistence. Ties preserve input order (stable sort).",
  paramsSchema: z.object({
    items: z.array(VEItemInputSchema).min(1).max(500),
    valueThreshold: DeprecatedThreshold,
    effortThreshold: DeprecatedThreshold,
  }),
  handler: async (params) => {
    const rows: PrioritizationItem[] = params.items.map((it) => ({
      id: it.id ?? candidateId("ve"),
      framework: FRAMEWORK,
      title: it.title,
      fields: VALUE_EFFORT.write(undefined, valuesOf(it.fields)),
      updatedAt: "",
    }));
    const given = new Map(rows.map((r, i) => [r.id, params.items[i].fields]));
    const ranked = rankMethodRows(FRAMEWORK, rows).map((r) => {
      const quadrant = (r.result.bucket as Quadrant | null) ?? null;
      return {
        id: r.row.id,
        title: r.row.title,
        fields: { ...given.get(r.row.id), quadrant },
        score: r.result.score,
        quadrant,
        quadrantScore: quadrant ? QUADRANT_SCORE[quadrant] : null,
      };
    });
    return { ranked, count: ranked.length, thresholds: THRESHOLDS };
  },
});

// ──────── tool.value_effort_matrix.list_items ────────
// Read-only snapshot of value-effort items, grouped by derived quadrant.

/** A listed row: read through to its item, with its value, effort and quadrant. */
type ListedVeRow = PrioritizationItem & {
  value: number | null;
  effort: number | null;
  quadrant: Quadrant | null;
};

function groupByQuadrant(rows: readonly PrioritizationItem[], items: readonly BacklogItem[]) {
  const groups: Record<Quadrant, ListedVeRow[]> = {
    quick_wins: [],
    big_bets: [],
    fill_ins: [],
    time_wasters: [],
  };
  const unplaced: ListedVeRow[] = [];
  for (const r of rankMethodRows(FRAMEWORK, rows, items)) {
    const quadrant = (r.result.bucket as Quadrant | null) ?? null;
    const listed: ListedVeRow = {
      ...r.row,
      fields: VALUE_EFFORT.write(r.row.fields, r.values),
      value: typeof r.values.value === "number" ? r.values.value : null,
      effort: typeof r.values.effort === "number" ? r.values.effort : null,
      quadrant,
    };
    if (quadrant) groups[quadrant].push(listed);
    else unplaced.push(listed);
  }
  return { groups, unplaced, count: rows.length, quadrants: VE_QUADRANTS, thresholds: THRESHOLDS };
}

const listItems = async (store: MethodStore) => {
  const [all, items] = await Promise.all([store.rows(), store.items()]);
  return groupByQuadrant(
    all.filter((x) => x.framework === FRAMEWORK),
    items
  );
};

registry.register({
  id: "tool.value_effort_matrix.list_items",
  toolId: "tool.value_effort_matrix",
  name: "list_items",
  category: "read",
  description:
    "List all prioritization items in the workspace on the Value vs Effort matrix, grouped by quadrant (quick_wins / big_bets / fill_ins / time_wasters), the quadrant derived from value and effort with the page's rule; items with no value or effort yet are in `unplaced` (Not placed yet). Each row carries {value, effort, quadrant}; a row linked to a backlog item reads them from the item. Each group is sorted by value ÷ effort, highest first. Filtered to framework='value-effort'.",
  paramsSchema: z.object({}),
  handler: async () => listItems(clientStore()),
  mcpHandler: async (_params, ctx) => listItems(serverStore(ctx.userId)),
});

// ──────── tool.value_effort_matrix.classify_and_persist ────────
// Convenience: classify one item AND save it to the workspace.
const classifyAndPersist = async (
  store: MethodStore,
  params: z.infer<typeof VEItemInputSchema>
) => {
  const [saved] = await persistMethodRows(store, FRAMEWORK, [
    {
      id: params.id,
      title: params.title,
      values: valuesOf(params.fields),
      backlogItemId: params.backlogItemId,
    },
  ]);
  const quadrant = (saved.bucket as Quadrant | null) ?? null;
  return {
    id: saved.row.id,
    quadrant,
    score: saved.score,
    quadrantScore: quadrant ? QUADRANT_SCORE[quadrant] : null,
    backlogItemId: saved.backlogItemId,
    backlogUpdated: saved.backlogUpdated,
  };
};

registry.register({
  id: "tool.value_effort_matrix.classify_and_persist",
  toolId: "tool.value_effort_matrix",
  name: "classify_and_persist",
  category: "write",
  description:
    "Place a single item on the Value vs Effort matrix and persist it to workspace.prioritization with framework='value-effort' (value and effort stored; the quadrant is derived, never stored). An existing id keeps its other fields and its backlog link; backlogItemId links the row and writes value and effort to that backlog item. Returns {id, quadrant, score (value ÷ effort), quadrantScore, backlogItemId, backlogUpdated}.",
  paramsSchema: VEItemInputSchema.extend({
    valueThreshold: DeprecatedThreshold,
    effortThreshold: DeprecatedThreshold,
  }),
  handler: async (params) => classifyAndPersist(clientStore(), params),
  mcpHandler: async (params, ctx) => classifyAndPersist(serverStore(ctx.userId), params),
});

// ──────── tool.value_effort_matrix.place_item ────────
// Move one existing row on the matrix (the page's drag, for agents).
const PlaceSchema = z.object({
  id: z.string().min(1).describe("The value-effort row to move (list_items ids)"),
  value: ValueSchema,
  effort: EffortSchema,
});

const placeItem = async (store: MethodStore, params: z.infer<typeof PlaceSchema>) => {
  const row = await store.row(params.id);
  if (!row || row.framework !== FRAMEWORK) {
    throw new Error(
      `No Value vs Effort item ${params.id}: list them with tool.value_effort_matrix.list_items.`
    );
  }
  const [saved] = await persistMethodRows(store, FRAMEWORK, [
    { id: row.id, title: row.title, values: { value: params.value, effort: params.effort } },
  ]);
  const quadrant = (saved.bucket as Quadrant | null) ?? null;
  return {
    id: saved.row.id,
    quadrant,
    score: saved.score,
    backlogItemId: saved.backlogItemId,
    backlogUpdated: saved.backlogUpdated,
  };
};

registry.register({
  id: "tool.value_effort_matrix.place_item",
  toolId: "tool.value_effort_matrix",
  name: "place_item",
  category: "write",
  requiresConfirmation: false,
  description:
    "Move an existing Value vs Effort item to a new value and effort (place a 'Not placed yet' item, or move a placed one), as dragging it on the page does. A linked row writes value and effort to its backlog item. Returns {id, quadrant, score, backlogItemId, backlogUpdated}.",
  paramsSchema: PlaceSchema,
  handler: async (params) => placeItem(clientStore(), params),
  mcpHandler: async (params, ctx) => placeItem(serverStore(ctx.userId), params),
});

// ──────── tool.value_effort_matrix.set_position ────────
// Place, move or un-place one row: the page's drag, plus its editor's
// "clear both" that sends an item back to "Not placed yet".
const SetPositionSchema = z
  .object({
    id: z.string().min(1).describe("The value-effort row (list_items ids)"),
    value: ValueSchema.nullable().describe(
      `Value on the Fibonacci scale ${FIB_LIST}, or null (with effort null) to send the item back to Not placed yet`
    ),
    effort: EffortSchema.nullable().describe(
      "Effort 1-10, or null (with value null) to send the item back to Not placed yet"
    ),
    clearBacklog: z
      .boolean()
      .optional()
      .describe(
        "Un-placing a row linked to a backlog item clears only the item's effort (matrixEffort), as the page does: its value stays, because businessValue is also WSJF's business value. Pass true to clear the item's value too."
      ),
  })
  .refine((p) => (p.value === null) === (p.effort === null), {
    message:
      "Give both value and effort, or null for both (Not placed yet); one without the other is refused, as on the page.",
  });

const setPosition = async (store: MethodStore, params: z.infer<typeof SetPositionSchema>) => {
  if (params.value !== null && params.effort !== null) {
    return {
      ...(await placeItem(store, { id: params.id, value: params.value, effort: params.effort })),
      placed: true,
    };
  }
  const row = await store.row(params.id);
  if (!row || row.framework !== FRAMEWORK) {
    throw new Error(
      `No Value vs Effort item ${params.id}: list them with tool.value_effort_matrix.list_items.`
    );
  }
  const item = row.backlogItemId ? await store.item(row.backlogItemId) : undefined;
  // The page's rule (value-effort-matrix/model.ts trayDraft): a linked row
  // goes back to the tray by losing its effort, on the row and the item;
  // its value is the backlog's one value field, WSJF's business value too,
  // so it stays unless clearBacklog asks for it. Present as undefined: a
  // clear, as the page's editor saves a blanked input.
  const keepValue = item !== undefined && !params.clearBacklog;
  const values: Values = {
    value: keepValue ? VALUE_EFFORT.read(readThrough(row, item)).value : undefined,
    effort: undefined,
  };
  const now = new Date().toISOString();
  let backlogUpdated: string[] = [];
  let marks: PrioritizationItem[] = [];
  if (item) {
    // The item as it reads, its links made before Phase 7 included (the
    // page's itemSaveBase), from the rows as they were before this write.
    const legacy = savedByEngine(item) ? undefined : await store.rows();
    const base = legacy ? withLegacyLinks(item, legacy) : item;
    // A linked row reads through to its item: what it clears goes there too.
    const changes = itemPatchChanges(base, ownedPatch(FRAMEWORK, values, clearedKeys(values)));
    backlogUpdated = Object.keys(changes);
    if (backlogUpdated.length > 0) {
      // Its first save stamps it: the legacy rows that disagree with it
      // keep their question (but this row, whose save answers its own).
      if (legacy) marks = markLegacyDifferences(item, legacy, { except: row.id, now });
      await store.putItem(applyItemPatch(base, changes, now));
    }
  }
  await store.putRows([
    ...marks,
    methodRow({ id: row.id, framework: FRAMEWORK, title: row.title, values, prev: row, now }),
  ]);
  return {
    id: row.id,
    quadrant: null,
    score: null,
    placed: false,
    backlogItemId: item ? item.id : null,
    backlogUpdated,
  };
};

registry.register({
  id: "tool.value_effort_matrix.set_position",
  toolId: "tool.value_effort_matrix",
  name: "set_position",
  category: "write",
  requiresConfirmation: false,
  description: `Set one Value vs Effort item's place, as the page's drag and its editor do: {id, value, effort} places or moves it (the same as place_item; value on ${FIB_LIST}, effort 1-10), and value: null with effort: null sends it back to 'Not placed yet'. One without the other is refused. A linked row writes value and effort to its backlog item (businessValue, matrixEffort); un-placing a linked row clears its effort there and keeps its value (WSJF's business value is the same field), as the page does, unless clearBacklog: true clears the value too. Returns {id, quadrant, score, placed, backlogItemId, backlogUpdated (the item fields changed)}.`,
  paramsSchema: SetPositionSchema,
  handler: async (params) => setPosition(clientStore(), params),
  mcpHandler: async (params, ctx) => setPosition(serverStore(ctx.userId), params),
});

// ──────── tool.value_effort_matrix.persist_to_prioritization ────────
// Bulk write of items (typically the output of compute_and_rank).
// Each item upsert is idempotent; existing ids are updated in place.
const PersistSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1).max(200),
        fields: z
          .object({ value: ValueSchema.optional(), effort: EffortSchema.optional() })
          .optional()
          .describe(
            "Both, or neither (the item is listed as Not placed yet; a linked row loses its effort on the backlog item and keeps its value)"
          ),
        backlogItemId: z.string().optional().describe("Link the row to this backlog item"),
      })
    )
    .min(1)
    .max(500),
  valueThreshold: DeprecatedThreshold,
  effortThreshold: DeprecatedThreshold,
});

/**
 * One persist item as the method's inputs. Given neither value nor effort,
 * it goes to Not placed yet the way set_position un-places a row: its
 * effort is cleared, on a linked item too (matrixEffort), and a linked
 * row's value stays on the item, the backlog's one value field and WSJF's
 * business value (an unlinked row loses its own value with the write).
 */
const persistInput = (it: z.infer<typeof PersistSchema>["items"][number]): PersistInput => {
  const values = valuesOf(it.fields);
  const neither = values.value === undefined && values.effort === undefined;
  return {
    id: it.id,
    title: it.title,
    values,
    backlogItemId: it.backlogItemId,
    ...(neither ? { cleared: ["effort"] } : {}),
  };
};

const persistAll = async (store: MethodStore, params: z.infer<typeof PersistSchema>) => {
  const saved = await persistMethodRows(store, FRAMEWORK, params.items.map(persistInput));
  return {
    written: saved.map((s) => s.row.id),
    count: saved.length,
    placed: saved.map((s) => ({ id: s.row.id, quadrant: s.bucket, score: s.score })),
  };
};

registry.register({
  id: "tool.value_effort_matrix.persist_to_prioritization",
  toolId: "tool.value_effort_matrix",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of value/effort items to workspace.prioritization with framework='value-effort'. Each item gives both value and effort, or neither (it waits under 'Not placed yet'); one without the other is refused and nothing is written. Neither on a row linked to a backlog item (or a new row with backlogItemId) un-places it as set_position does: the item's effort (matrixEffort) is cleared and its value stays, being WSJF's business value too. The quadrant is derived, never stored. Items without an id get one generated; an existing id is updated in place, keeping its other fields and backlog link. Returns {written, count, placed}: each item's quadrant and score as list_items then shows them (a linked row's from its item).",
  paramsSchema: PersistSchema,
  handler: async (params) => persistAll(clientStore(), params),
  mcpHandler: async (params, ctx) => persistAll(serverStore(ctx.userId), params),
});
