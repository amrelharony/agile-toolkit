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
 * Eisenhower Matrix is different: inputs are two answers (urgent? +
 * important?) and the output is a discrete quadrant. We still surface a
 * numeric `score` (4 / 3 / 2 / 1 for do / schedule / delegate / delete)
 * so the shared `PrioritizationItem.score` sort column produces a
 * sensible order without special-casing.
 *
 * ─── Derived, as the page derives it ─────────────────────────────────
 * The quadrant comes from the method registry (lib/prioritization/methods/
 * eisenhower), the code the page uses, and is never stored:
 * - urgent = the urgent answer is yes, OR the task is due within 2 days
 *   (overdue included), with the reason returned (`urgentBecause`);
 * - a task missing an answer lists under `unsorted` (Not sorted yet),
 *   never Do;
 * - rows store `urgent` / `important` as "true" / "false", plus `dueAt`
 *   (YYYY-MM-DD) and `delegateTo` (a person's name). A `quadrant` given to a
 *   persist is turned into the pair (an error when it contradicts the
 *   answers given); a legacy stored one is read as the pair, over any
 *   stored answers (it was the old app's pane: see legacyAware).
 * "Today" is the server's date unless the call passes `today`.
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";
import { registry } from "../registry";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { method, type Values } from "@/lib/prioritization/methods";
import { toChoice } from "@/lib/prioritization/methods/fields";
import {
  EISENHOWER_QUADRANTS,
  EISENHOWER_SCORE,
  eisenhowerQuadrant,
  urgency,
  type EisenhowerQuadrant,
} from "@/lib/prioritization/methods/eisenhower";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  clientStore,
  listMethodRows,
  persistMethodRows,
  serverStore,
  type MethodStore,
} from "./_method-rows";

const FRAMEWORK = "eisenhower" as const;
const EISENHOWER = method(FRAMEWORK);

type QuadrantId = EisenhowerQuadrant;

const QuadrantSchema = z.enum(EISENHOWER_QUADRANTS);

const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The answers a quadrant stands for. */
const PAIR: Record<QuadrantId, { urgent: boolean; important: boolean }> = {
  do: { urgent: true, important: true },
  schedule: { urgent: false, important: true },
  delegate: { urgent: true, important: false },
  delete: { urgent: false, important: false },
};

const UrgentSchema = z
  .boolean()
  .describe(
    "Is the task time-sensitive / does waiting cause harm soon? (A due date within 2 days makes it urgent anyway.)"
  );
const ImportantSchema = z
  .boolean()
  .describe("Does the task move a meaningful goal forward (vs. just feel busy)?");
const DueSchema = DaySchema.describe(
  "Optional YYYY-MM-DD due date (can be past); within 2 days, or overdue, counts as urgent"
);
const DelegateSchema = z
  .string()
  .min(1)
  .max(80)
  .describe("Optional: who takes it (a roster name), for a Delegate task");

/** Shared input shape for one Eisenhower candidate. */
const EisenhowerFieldsSchema = z.object({
  urgent: UrgentSchema,
  important: ImportantSchema,
  dueAt: DueSchema.optional(),
  delegateTo: DelegateSchema.optional(),
});

/** A persist's due date and delegate: left out, an existing task keeps them; null clears one. */
const PersistDueSchema = DueSchema.nullable()
  .optional()
  .describe(
    "Optional YYYY-MM-DD due date (can be past); within 2 days, or overdue, counts as urgent. Left out, an existing task keeps its date; null clears it."
  );
const PersistDelegateSchema = DelegateSchema.nullable()
  .optional()
  .describe(
    "Optional: who takes it (a roster name), for a Delegate task. Left out, an existing task keeps it; null clears it."
  );

const EisenhowerItemInputSchema = z.object({
  id: z.string().optional().describe("Stable identifier; auto-generated if omitted on persist"),
  title: z.string().min(1).max(200),
  fields: EisenhowerFieldsSchema.extend({
    dueAt: PersistDueSchema,
    delegateTo: PersistDelegateSchema,
  }),
});

/**
 * The store with legacy rows read as the old app showed them. Before
 * Phase 7 the pane WAS the stored `quadrant`: the old page's quadrant menu
 * changed only it, and these actions stored it beside `urgent` /
 * `important` (a quadrant the agent decided overriding them). New code
 * never stores a quadrant (the method's write drops it), so a row that
 * still holds a valid one is legacy and its quadrant is the user's last
 * word: its `urgent` / `important` are set aside and the method maps the
 * quadrant back to its answers. The next write stores those answers.
 *
 * The page's legacyQuadrantFirst (eisenhower/model.ts) is the same rule;
 * an agent module can't import a page, and a parity test holds the two to
 * the same panes.
 */
function legacyAware(store: MethodStore): MethodStore {
  const read = (row: PrioritizationItem): PrioritizationItem => {
    if (row.framework !== FRAMEWORK || !toChoice(EISENHOWER_QUADRANTS, row.fields?.quadrant)) {
      return row;
    }
    const fields = { ...row.fields };
    delete fields.urgent;
    delete fields.important;
    return { ...row, fields };
  };
  return {
    ...store,
    rows: async () => (await store.rows()).map(read),
    row: async (id) => {
      const row = await store.row(id);
      return row ? read(row) : row;
    },
  };
}

/** Where the actions read and write: the browser store or the user's server rows, legacy-aware. */
const client = () => legacyAware(clientStore());
const server = (userId: string) => legacyAware(serverStore(userId));

const bool = (b: boolean | undefined) => (b === undefined ? undefined : b ? "true" : "false");

/** A task's answers as given: a due date or delegate of null is a clear (see clearedOf). */
type TaskFields = {
  urgent?: boolean;
  important?: boolean;
  dueAt?: string | null;
  delegateTo?: string | null;
};

const valuesOf = (f: TaskFields): Values => ({
  urgent: bool(f.urgent),
  important: bool(f.important),
  dueAt: f.dueAt ?? undefined,
  delegateTo: f.delegateTo ?? undefined,
});

/** The inputs a call clears with null. */
const clearedOf = (f: TaskFields | undefined): string[] =>
  (["dueAt", "delegateTo"] as const).filter((k) => f?.[k] === null);

/**
 * The inputs a persist may leave out that an existing task keeps (its
 * answers, due date and delegate), as the page's editor shows them.
 */
const KEEP = ["urgent", "important", "dueAt", "delegateTo"];

/** The quadrant, its sort score and why it's urgent, for a set of answers today. */
function classify(v: Values, today: string) {
  const quadrant = eisenhowerQuadrant(v, today);
  const u = urgency(v, today);
  return {
    quadrant,
    score: quadrant ? EISENHOWER_SCORE[quadrant] : null,
    urgentBecause: u.because,
    daysToDue: u.daysToDue,
  };
}

// ──────── tool.eisenhower.classify ────────
// Pure: classify one task. No persistence, no side effects.
registry.register({
  id: "tool.eisenhower.classify",
  toolId: "tool.eisenhower",
  name: "classify",
  category: "read",
  description:
    "Classify one task by (urgent, important) into the Eisenhower quadrant, as the page does: 'do' (urgent+important), 'schedule' (important, not urgent), 'delegate' (urgent, not important), 'delete' (neither). A dueAt within 2 days (or overdue) makes it urgent. Returns { quadrant, score (4/3/2/1), urgentBecause ('toggle' | 'due' | null), daysToDue, rule }.",
  paramsSchema: EisenhowerFieldsSchema.extend({
    today: DaySchema.optional().describe("YYYY-MM-DD to judge due dates against (default: today)"),
  }),
  handler: async (params) => ({
    ...classify(valuesOf(params), params.today ?? todayLocalISO()),
    rule: "do = U+I, schedule = ¬U+I, delegate = U+¬I, delete = ¬U+¬I; U = urgent or due within 2 days",
  }),
  // No mcpHandler — pure compute runs identically on server and client.
});

// ──────── tool.eisenhower.list_items ────────
// Read-only snapshot of Eisenhower tasks, grouped by derived quadrant.
const listItems = async (store: MethodStore, today: string) => {
  const listed = await listMethodRows(store, FRAMEWORK, { today });
  const grouped = Object.fromEntries(
    [...EISENHOWER_QUADRANTS, "unsorted"].map((q) => [q, [] as typeof listed])
  ) as Record<QuadrantId | "unsorted", typeof listed>;
  for (const row of listed) grouped[(row.bucket as QuadrantId | null) ?? "unsorted"].push(row);
  // Newest first within each: agents usually want "what did I just add" at the top.
  for (const q of Object.keys(grouped) as (QuadrantId | "unsorted")[]) {
    grouped[q].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return { ...grouped, total: listed.length, today };
};

const TodayParam = z.object({
  today: DaySchema.optional().describe("YYYY-MM-DD to judge due dates against (default: today)"),
});

registry.register({
  id: "tool.eisenhower.list_items",
  toolId: "tool.eisenhower",
  name: "list_items",
  category: "read",
  description:
    "List all Eisenhower tasks in the workspace, grouped by quadrant derived today: { do, schedule, delegate, delete, unsorted, total, today }. A task missing an answer is under unsorted (never Do). A legacy row that still holds a stored quadrant (the old page's pick, or an old agent override) is listed in that quadrant, as the page shows it, its answers read from it. Each row carries {bucket, score, values: {urgent, important, dueAt, delegateTo}, extra: {urgentBecause, daysToDue}}; each group is newest first. Filtered to framework='eisenhower'.",
  paramsSchema: TodayParam,
  handler: async (params) => listItems(client(), params.today ?? todayLocalISO()),
  mcpHandler: async (params, ctx) => listItems(server(ctx.userId), params.today ?? todayLocalISO()),
});

// ──────── tool.eisenhower.classify_and_persist ────────
// Convenience: classify one task AND save it to the workspace.
const classifyAndPersist = async (
  store: MethodStore,
  params: z.infer<typeof EisenhowerItemInputSchema>
) => {
  const today = todayLocalISO();
  const [saved] = await persistMethodRows(
    store,
    FRAMEWORK,
    [
      {
        id: params.id,
        title: params.title,
        values: valuesOf(params.fields),
        cleared: clearedOf(params.fields),
      },
    ],
    { ctx: { today }, keep: KEEP }
  );
  const c = classify(EISENHOWER.read(saved.row.fields), today);
  return { id: saved.row.id, quadrant: c.quadrant, score: c.score, urgentBecause: c.urgentBecause };
};

registry.register({
  id: "tool.eisenhower.classify_and_persist",
  toolId: "tool.eisenhower",
  name: "classify_and_persist",
  category: "write",
  description:
    "Classify one task by (urgent, important) and persist it to workspace.prioritization with framework='eisenhower'. The answers (and dueAt / delegateTo) are stored; the quadrant is derived on read, never stored, and the sort score (4/3/2/1) goes on PrioritizationItem.score. An existing id keeps its other fields, and the dueAt and delegateTo the call leaves out (null clears one). Returns { id, quadrant, score, urgentBecause }.",
  paramsSchema: EisenhowerItemInputSchema,
  handler: async (params) => classifyAndPersist(client(), params),
  mcpHandler: async (params, ctx) => classifyAndPersist(server(ctx.userId), params),
});

// ──────── tool.eisenhower.update_task ────────
// Change one task's answers, due date or delegate; the quadrant follows.
const UpdateSchema = z.object({
  id: z.string().min(1).describe("The task (list_items ids)"),
  title: z.string().min(1).max(200).optional(),
  urgent: UrgentSchema.optional(),
  important: ImportantSchema.optional(),
  dueAt: DaySchema.nullable().optional().describe("YYYY-MM-DD, or null to clear it"),
  delegateTo: z.string().max(80).nullable().optional().describe("A name, or null to clear it"),
});

const updateTask = async (store: MethodStore, params: z.infer<typeof UpdateSchema>) => {
  const row = await store.row(params.id);
  if (!row || row.framework !== FRAMEWORK) {
    throw new Error(`No Eisenhower task ${params.id}: list them with tool.eisenhower.list_items.`);
  }
  const values: Values = { ...EISENHOWER.read(row.fields) };
  if (params.urgent !== undefined) values.urgent = bool(params.urgent);
  if (params.important !== undefined) values.important = bool(params.important);
  if (params.dueAt !== undefined) values.dueAt = params.dueAt ?? undefined;
  if (params.delegateTo !== undefined) values.delegateTo = params.delegateTo?.trim() || undefined;
  const today = todayLocalISO();
  const [saved] = await persistMethodRows(
    store,
    FRAMEWORK,
    [{ id: row.id, title: params.title ?? row.title, values }],
    { ctx: { today } }
  );
  const c = classify(EISENHOWER.read(saved.row.fields), today);
  return { id: saved.row.id, quadrant: c.quadrant, score: c.score, urgentBecause: c.urgentBecause };
};

registry.register({
  id: "tool.eisenhower.update_task",
  toolId: "tool.eisenhower",
  name: "update_task",
  category: "write",
  requiresConfirmation: false,
  description:
    "Update one Eisenhower task: its title, urgent / important answers, due date (null clears it) or who takes it (null clears it). The quadrant follows from the answers. Returns { id, quadrant, score, urgentBecause }.",
  paramsSchema: UpdateSchema,
  handler: async (params) => updateTask(client(), params),
  mcpHandler: async (params, ctx) => updateTask(server(ctx.userId), params),
});

// ──────── tool.eisenhower.persist_to_prioritization ────────
// Bulk write of tasks. Each gives its answers, a quadrant, or both (they
// must agree). requiresConfirmation:false because each upsert is
// idempotent by id.
const PersistItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(200),
  fields: z
    .object({
      urgent: UrgentSchema.optional(),
      important: ImportantSchema.optional(),
      dueAt: PersistDueSchema,
      delegateTo: PersistDelegateSchema,
    })
    .optional(),
  /** A quadrant the agent already decided: turned into the answers it stands for. */
  quadrant: QuadrantSchema.optional().describe(
    "Optional: the quadrant, turned into its answers (do = urgent+important, …); refused when it contradicts urgent/important given"
  ),
});

/** The answers for one bulk item: from its fields, or its quadrant (they must agree). */
function answersOf(it: z.infer<typeof PersistItemSchema>): Values {
  const f = it.fields ?? {};
  if (it.quadrant) {
    const pair = PAIR[it.quadrant];
    if (
      (f.urgent !== undefined && f.urgent !== pair.urgent) ||
      (f.important !== undefined && f.important !== pair.important)
    ) {
      throw new Error(
        `“${it.title}”: quadrant '${it.quadrant}' contradicts urgent=${f.urgent} / important=${f.important}.`
      );
    }
    return valuesOf({ ...f, urgent: pair.urgent, important: pair.important });
  }
  return valuesOf(f);
}

const persistAll = async (
  store: MethodStore,
  params: { items: z.infer<typeof PersistItemSchema>[] }
) => {
  const today = todayLocalISO();
  const saved = await persistMethodRows(
    store,
    FRAMEWORK,
    params.items.map((it) => ({
      id: it.id,
      title: it.title,
      values: answersOf(it),
      cleared: clearedOf(it.fields),
    })),
    { ctx: { today }, keep: KEEP }
  );
  const written = saved.map((s) => {
    const c = classify(EISENHOWER.read(s.row.fields), today);
    return { id: s.row.id, quadrant: c.quadrant, score: c.score };
  });
  return { written, count: written.length };
};

registry.register({
  id: "tool.eisenhower.persist_to_prioritization",
  toolId: "tool.eisenhower",
  name: "persist_to_prioritization",
  category: "write",
  requiresConfirmation: false,
  description:
    "Persist a batch of Eisenhower tasks to workspace.prioritization. Each item supplies title + fields ({ urgent, important, dueAt?, delegateTo? }) and/or a quadrant (turned into its answers; a contradiction is refused and nothing is written). The quadrant + numeric sort score (4/3/2/1) are derived. Items without an id get one generated; an existing id is updated in place, keeping the answers, dueAt and delegateTo an item leaves out (null clears dueAt or delegateTo).",
  paramsSchema: z.object({ items: z.array(PersistItemSchema).min(1).max(500) }),
  handler: async (params) => persistAll(client(), params),
  mcpHandler: async (params, ctx) => persistAll(server(ctx.userId), params),
});
