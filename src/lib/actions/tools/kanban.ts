/**
 * Kanban Board — tool-local actions.
 *
 * Category: Flow & Delivery (squad S6)
 * Agent surface: tool.kanban.*
 * Backing CRUD : workspace.kanban_board.* (auto-generated). Singleton: one
 *                board document under a fixed id.
 *
 *   1. list_state — per-column counts and blocked cards, WIP-limit
 *      breaches, and the cycle time of cards in Done (startedAt →
 *      completedAt in whole local days, both counted, as lib/flow counts
 *      it): average, P85 and how many cards they rest on.
 *   2. add_card   — add a card (defaults: backlog column, standard class).
 *   3. move_card  — move a card to a column, stamped and recorded in the
 *      card's history as the page does it (movedCard in lib/kanban/flow).
 *   Both writes stamp the cards' blocked spells (lib/flow/block-stamps) on
 *   either transport: a card added blocked opens one, a move into Done
 *   closes it.
 *   4. get_workflow / update_workflow / save_workflow_version /
 *      compare_workflow_version — the Definition of Workflow
 *      (workspace:workflowDefinition, one document; lib/kanban/workflow).
 *   5. set_blocked — flag a Flow-board card blocked or clear it, with a
 *      cause and a cluster on its blocked spell.
 *
 * Entity kind "workspace:kanbanBoard" (camelCase via kindFromToolId) matches
 * the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  BLOCKER_CLUSTER_MAX,
  KANBAN_BOARD_ID,
  MEETING_CADENCES,
  WORK_TYPES,
  WORKFLOW_DEFINITION_ID,
  WORKFLOW_DEFINITION_KIND,
  WORKFLOW_SLE_PERCENTILES,
  type KanbanBoard,
  type KanbanCard,
  type KanbanColumnId,
  type StatikNotes,
  type Story,
  type WorkType,
  type WorkflowDefinition,
} from "@/lib/stores/workspace-types";
import { cycleStats, KANBAN_HISTORY_CAP, movedCard, WORKING } from "@/lib/kanban/flow";
import {
  CADENCE_ID_MAX,
  CADENCE_MINUTES,
  COMPARE_WEEKS,
  KANBAN_CADENCES_MAX,
  SLE_DAYS,
  STAGE_ID_MAX,
  STAGE_POLICIES_MAX,
  STATIK_KEYS,
  STATIK_NOTE_MAX,
  WORKFLOW_TEXT_MAX,
  WORKFLOW_VERSIONS_MAX,
  compareBoard,
  compareVersion,
  describedBoard,
  mergeWorkflow,
  normalizeWorkflowDefinition,
  sleFromHistory,
  withSavedVersion,
  workflowItems,
  type CompareWeeks,
  type WorkflowPatch,
} from "@/lib/kanban/workflow";
import { stampBoardBlocks, withSpellNote } from "@/lib/flow/block-stamps";
import { validateTargetSplit, withTargetSplit } from "@/lib/flow/work-types";
import { defaultClusterSide } from "@/lib/impediments/clusters";
import { isExampleId } from "@/lib/utils/example-id";

const KIND_KANBAN = "workspace:kanbanBoard";
const KIND_STORY = "workspace:story";

const COLUMNS: KanbanColumnId[] = ["backlog", "ready", "in_progress", "review", "done"];

const ws = () => useWorkspaceStore.getState();

function emptyBoard(): KanbanBoard {
  return {
    id: KANBAN_BOARD_ID,
    cards: [],
    wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
  };
}

function browserBoard(): KanbanBoard | null {
  return (ws().kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID) ?? null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

function summarize(board: KanbanBoard | null) {
  if (!board) {
    return {
      exists: false,
      totalCards: 0,
      byColumn: {},
      blockedByColumn: {},
      wipBreaches: [],
      avgCycleTimeDays: null,
      p85CycleTimeDays: null,
      cycleTimeSample: 0,
    };
  }
  const byColumn: Record<string, number> = {};
  const blockedByColumn: Record<string, number> = {};
  for (const c of COLUMNS) {
    byColumn[c] = 0;
    blockedByColumn[c] = 0;
  }
  for (const card of board.cards) {
    byColumn[card.column] = (byColumn[card.column] ?? 0) + 1;
    if (card.blocked) blockedByColumn[card.column] = (blockedByColumn[card.column] ?? 0) + 1;
  }
  // WIP breach: a column whose limit > 0 and current count exceeds it.
  const wipBreaches = COLUMNS.filter(
    (c) => (board.wipLimits[c] ?? 0) > 0 && byColumn[c] > board.wipLimits[c]
  ).map((c) => ({ column: c, count: byColumn[c], limit: board.wipLimits[c] }));
  // Cycle time of the cards in Done, counted as the page counts it.
  const cycle = cycleStats(board.cards);
  return {
    exists: true,
    totalCards: board.cards.length,
    byColumn,
    blockedByColumn,
    wipBreaches,
    avgCycleTimeDays: round1(cycle.average),
    p85CycleTimeDays: round1(cycle.p85),
    cycleTimeSample: cycle.count,
  };
}

// ──────── tool.kanban.list_state ────────
registry.register({
  id: "tool.kanban.list_state",
  toolId: "tool.kanban",
  name: "list_state",
  category: "read",
  description:
    "Summarise the kanban Flow board. Returns {exists, totalCards, byColumn: {column: count}, blockedByColumn: {column: count}, wipBreaches: {column, count, limit}[], avgCycleTimeDays | null, p85CycleTimeDays | null, cycleTimeSample} — cycle time is startedAt→completedAt of the cards in done, in whole local days with both counted (a card started and finished the same day took 1 day); the page quotes the average from 3 cards and the P85 from 5. The sprint board is the stories: read them with workspace.story.list.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserBoard()),
  mcpHandler: async (_params, ctx) => {
    const board = await serverGetEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, KANBAN_BOARD_ID);
    return summarize(board ?? null);
  },
});

const ColumnEnum = z.enum(["backlog", "ready", "in_progress", "review", "done"]);
const ClassEnum = z.enum(["standard", "expedite", "fixed_date", "intangible"]);

// ──────── tool.kanban.add_card ────────
registry.register({
  id: "tool.kanban.add_card",
  toolId: "tool.kanban",
  name: "add_card",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a card to the board (defaults: column 'backlog', class 'standard'), optionally with an assignee and a blocked flag (a card added blocked opens a blocked spell from now: give it a cause with set_blocked). Creates the board if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    title: z.string().trim().min(1),
    description: z.string().optional(),
    column: ColumnEnum.optional(),
    class: ClassEnum.optional(),
    assignee: z.string().trim().max(120).optional(),
    blocked: z.boolean().optional(),
  }),
  handler: async (params) => {
    const board = browserBoard() ?? emptyBoard();
    const card = newCard(params);
    ws().upsertKanbanBoard({ ...board, cards: [...board.cards, card] });
    return { added: true, id: card.id };
  },
  mcpHandler: async (params, ctx) => {
    const stored = await serverGetEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, KANBAN_BOARD_ID);
    const board = stored ?? emptyBoard();
    const card = newCard(params);
    // A card added blocked opens its blocked spell, as the store's own write does.
    await serverUpsertEntity<KanbanBoard>(
      ctx.userId,
      KIND_KANBAN,
      stampBoardBlocks({ ...board, cards: [...board.cards, card] }, stored ?? undefined)
    );
    return { added: true, id: card.id };
  },
});

// ──────── tool.kanban.move_card ────────
registry.register({
  id: "tool.kanban.move_card",
  toolId: "tool.kanban",
  name: "move_card",
  category: "write",
  requiresConfirmation: false,
  description: `Move a card to a column, stamped as the page does: columnSince always; startedAt on entering in_progress or review (dropped on going back to backlog or ready); completedAt on entering done (dropped on leaving it); entering done clears blocked and closes the card's open blocked spell; the move is appended to the card's history ({column, from, at}, oldest first, the latest ${KANBAN_HISTORY_CAP} kept), which the flow charts read. Returns {updated: true} or {updated: false} when the board/card is unknown.`,
  paramsSchema: z.object({ cardId: z.string(), column: ColumnEnum }),
  handler: async (params) => {
    const board = browserBoard();
    if (!board) return { updated: false };
    const next = moveCard(board, params.cardId, params.column);
    if (!next) return { updated: false };
    ws().upsertKanbanBoard(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const board = await serverGetEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, KANBAN_BOARD_ID);
    if (!board) return { updated: false };
    const next = moveCard(board, params.cardId, params.column);
    if (!next) return { updated: false };
    // A move into Done drops the flag, which closes the open blocked spell.
    await serverUpsertEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, stampBoardBlocks(next, board));
    return { updated: true };
  },
});

function newCard(params: {
  title: string;
  description?: string;
  column?: KanbanColumnId;
  class?: KanbanCard["class"];
  assignee?: string;
  blocked?: boolean;
}): KanbanCard {
  const column = params.column ?? "backlog";
  const now = today();
  const assignee = params.assignee?.trim();
  return {
    id: crypto.randomUUID(),
    title: params.title,
    ...(params.description ? { description: params.description } : {}),
    column,
    class: params.class ?? "standard",
    createdAt: now,
    columnSince: now,
    ...(WORKING.has(column) ? { startedAt: now } : {}),
    ...(column === "done" ? { completedAt: now } : {}),
    ...(assignee ? { assignee } : {}),
    // A done card can't be blocked (as on the page).
    ...(params.blocked && column !== "done" ? { blocked: true } : {}),
  };
}

/** Return a new board with the card moved, or null if the card isn't found. */
function moveCard(board: KanbanBoard, cardId: string, column: KanbanColumnId): KanbanBoard | null {
  if (!board.cards.some((c) => c.id === cardId)) return null;
  const at = new Date().toISOString();
  return {
    ...board,
    cards: board.cards.map((c) => (c.id === cardId ? movedCard(c, column, at) : c)),
  };
}

/* ── The Definition of Workflow ──────────────────────────────────────── */

type Fail = { ok: false; error: string; hint: string };
const fail = (error: string, hint: string): Fail => ({ ok: false, error, hint });

/** What the workflow verbs read: the definition, the Flow board and the stories. */
interface WorkflowWorld {
  def: WorkflowDefinition | null;
  board: KanbanBoard | null;
  stories: Story[];
}

function browserWorld(): WorkflowWorld {
  const s = ws();
  return {
    def: (s.workflowDefinitions ?? []).find((d) => d.id === WORKFLOW_DEFINITION_ID) ?? null,
    board: browserBoard(),
    stories: s.stories ?? [],
  };
}

async function serverWorld(userId: string, { stories = true } = {}): Promise<WorkflowWorld> {
  const [def, board, list] = await Promise.all([
    serverGetEntity<WorkflowDefinition>(userId, WORKFLOW_DEFINITION_KIND, WORKFLOW_DEFINITION_ID),
    serverGetEntity<KanbanBoard>(userId, KIND_KANBAN, KANBAN_BOARD_ID),
    stories ? serverListEntities<Story>(userId, KIND_STORY) : Promise.resolve([] as Story[]),
  ]);
  return { def, board, stories: list };
}

const boardLimits = (board: KanbanBoard | null) => (board ?? emptyBoard()).wipLimits;

function workflowState({ def, board, stories }: WorkflowWorld) {
  const described = describedBoard(def);
  const items = described
    ? workflowItems(described, { stories, boards: board ? [board] : [] })
    : [];
  return {
    exists: def !== null,
    definition: def ? normalizeWorkflowDefinition(def) : null,
    board: described,
    wipLimits: boardLimits(board),
    sleFromHistory: described ? sleFromHistory(items, def?.sle?.pct ?? 85) : null,
    versions: (def?.versions ?? []).map((v) => ({
      version: v.version,
      savedAt: v.savedAt,
      ...(v.note ? { note: v.note } : {}),
    })),
  };
}

// ──────── tool.kanban.get_workflow ────────
registry.register({
  id: "tool.kanban.get_workflow",
  toolId: "tool.kanban",
  name: "get_workflow",
  category: "read",
  description:
    "Read the team's Definition of Workflow (Kanban): one document describing one board. Returns {exists, definition (board, workItem, startPoint, finishPoint, workTypes, policies per stage, classPolicies, wipPolicy, pullPolicy, blockerPolicy, sle {days, pct}, statik notes, cadences, versions) | null, board: 'sprint' | 'flow' | null (the board it describes), wipLimits (both boards share them; the Sprint board's To do uses ready's), sleFromHistory: {days, pct, sample} | null (the pct-th percentile of the described board's finished items' cycle days, whole local days with both counted, from 5 items), versions: {version, savedAt, note?}[]}.",
  paramsSchema: z.object({}),
  handler: async () => workflowState(browserWorld()),
  mcpHandler: async (_params, ctx) => workflowState(await serverWorld(ctx.userId)),
});

const optText = (max: number = WORKFLOW_TEXT_MAX) => z.string().max(max).nullable().optional();

const SlePct = z.literal(WORKFLOW_SLE_PERCENTILES).describe("Cycle Time's percentiles.");

const UpdateWorkflowParams = z.object({
  board: z.enum(["sprint", "flow"]).nullable().optional().describe("The board it describes."),
  workItem: optText().describe("What one item of work is."),
  startPoint: optText().describe(
    "Where work counts as started (text only: cycle time still counts from In progress)."
  ),
  finishPoint: optText(),
  wipPolicy: optText(),
  pullPolicy: optText(),
  blockerPolicy: optText(),
  policies: z
    .array(
      z.object({
        stage: z.string().min(1).max(STAGE_ID_MAX).describe("A stage id of the board, never done."),
        enter: z.string().max(WORKFLOW_TEXT_MAX).optional(),
        exit: z.string().max(WORKFLOW_TEXT_MAX).optional(),
      })
    )
    .max(STAGE_POLICIES_MAX)
    .nullable()
    .optional()
    .describe("Replaces every stage policy."),
  classPolicies: z
    .array(
      z.object({
        class: z.enum(["standard", "expedite", "fixed_date", "intangible"]),
        policy: z.string().max(WORKFLOW_TEXT_MAX),
      })
    )
    .max(4)
    .nullable()
    .optional(),
  sle: z
    .object({ days: z.number().int().min(SLE_DAYS.min).max(SLE_DAYS.max), pct: SlePct })
    .nullable()
    .optional(),
  statik: z
    .object({
      inside: optText(STATIK_NOTE_MAX),
      outside: optText(STATIK_NOTE_MAX),
      demand: optText(STATIK_NOTE_MAX),
      capability: optText(STATIK_NOTE_MAX),
      workflow: optText(STATIK_NOTE_MAX),
      classes: optText(STATIK_NOTE_MAX),
      design: optText(STATIK_NOTE_MAX),
      rollout: optText(STATIK_NOTE_MAX),
    })
    .optional()
    .describe("STATIK notes to set (null or empty clears one); notes left out stay."),
  cadences: z
    .array(
      z.object({
        id: z.string().min(1).max(CADENCE_ID_MAX).optional(),
        name: z.string().min(1).max(WORKFLOW_TEXT_MAX),
        cadence: z.enum(MEETING_CADENCES),
        minutes: z.number().int().min(CADENCE_MINUTES.min).max(CADENCE_MINUTES.max).optional(),
        purpose: z.string().max(WORKFLOW_TEXT_MAX).optional(),
      })
    )
    .max(KANBAN_CADENCES_MAX)
    .nullable()
    .optional()
    .describe("Replaces the Kanban cadences."),
  meanings: z
    .object({
      feature: optText(),
      defect: optText(),
      debt: optText(),
      risk: optText(),
    })
    .optional()
    .describe("What each work type means for the team (null or empty clears one)."),
  targetSplit: z
    .object({
      feature: z.number().int().min(0).max(100).nullable(),
      defect: z.number().int().min(0).max(100).nullable(),
      debt: z.number().int().min(0).max(100).nullable(),
      risk: z.number().int().min(0).max(100).nullable(),
    })
    .nullable()
    .optional()
    .describe(
      "The target mix of finished work: four whole numbers adding up to 100, or null (or all four null) to clear it."
    ),
});

type UpdateWorkflowInput = z.infer<typeof UpdateWorkflowParams>;

/** The definition with an agent's change applied, or a refusal. */
export function planWorkflowUpdate(
  def: WorkflowDefinition | null,
  params: UpdateWorkflowInput,
  at: string = new Date().toISOString()
): { def: WorkflowDefinition } | Fail {
  const { statik, cadences, meanings, targetSplit, ...rest } = params;
  const patch: WorkflowPatch = { ...(rest as WorkflowPatch) };
  if (statik) {
    const notes: Record<string, unknown> = { ...(def?.statik ?? {}) };
    for (const key of STATIK_KEYS) {
      const value = statik[key];
      if (value === undefined) continue;
      if (value === null || value.trim() === "") delete notes[key];
      else notes[key] = value;
    }
    patch.statik = notes as StatikNotes;
  }
  if (cadences !== undefined) {
    patch.cadences =
      cadences === null
        ? null
        : cadences.map((c) => ({ ...c, id: c.id ?? `cadence-${nanoid(8)}` }));
  }
  if (meanings) {
    const byType = new Map((def?.workTypes ?? []).map((w) => [w.type, { ...w }]));
    for (const type of WORK_TYPES) {
      const meaning = meanings[type];
      if (meaning === undefined) continue;
      const entry = byType.get(type) ?? { type };
      if (meaning === null || !meaning.trim()) delete entry.meaning;
      else entry.meaning = meaning;
      byType.set(type, entry);
    }
    patch.workTypes = WORK_TYPES.flatMap((t: WorkType) => {
      const entry = byType.get(t);
      return entry ? [entry] : [];
    });
  }
  let next = mergeWorkflow(def, patch, at);
  if (targetSplit !== undefined) {
    const v = validateTargetSplit(targetSplit ?? {});
    if (!v.ok) {
      return fail(
        "bad_target_split",
        Object.values(v.errors).join(" ") ||
          "Give four whole numbers from 0 to 100 that add up to 100, or null to clear the target."
      );
    }
    next = withTargetSplit(next, v.values, at);
  }
  return { def: next };
}

// ──────── tool.kanban.update_workflow ────────
registry.register({
  id: "tool.kanban.update_workflow",
  toolId: "tool.kanban",
  name: "update_workflow",
  category: "write",
  requiresConfirmation: false,
  description: `Change the team's Definition of Workflow (it is created when there is none). Every field is optional: a field left out stays, null clears it. Texts are at most ${WORKFLOW_TEXT_MAX} characters (STATIK notes ${STATIK_NOTE_MAX}); policies replace every stage policy (at most ${STAGE_POLICIES_MAX}; a policy for done is dropped: Done means the Definition of Done); cadences replace the list (at most ${KANBAN_CADENCES_MAX}); targetSplit is four whole numbers adding up to 100, which Flow Insights reads for both boards. Returns {ok: true, updated, definition} or {ok: false, error, hint}.`,
  paramsSchema: UpdateWorkflowParams,
  handler: async (params) => {
    const { def } = browserWorld();
    const plan = planWorkflowUpdate(def, params);
    if ("ok" in plan) return plan;
    if (plan.def !== def) ws().upsertWorkflowDefinition(plan.def);
    return { ok: true, updated: plan.def !== def, definition: plan.def };
  },
  mcpHandler: async (params, ctx) => {
    const def = await serverGetEntity<WorkflowDefinition>(
      ctx.userId,
      WORKFLOW_DEFINITION_KIND,
      WORKFLOW_DEFINITION_ID
    );
    const plan = planWorkflowUpdate(def, params);
    if ("ok" in plan) return plan;
    if (plan.def !== def) {
      await serverUpsertEntity<WorkflowDefinition>(ctx.userId, WORKFLOW_DEFINITION_KIND, plan.def);
    }
    return { ok: true, updated: plan.def !== def, definition: plan.def };
  },
});

const SaveVersionParams = z.object({
  note: z.string().max(WORKFLOW_TEXT_MAX).optional().describe("What changed."),
  expect: z
    .string()
    .max(WORKFLOW_TEXT_MAX)
    .optional()
    .describe("What the team expects it to change."),
});

function planSaveVersion(world: WorkflowWorld, params: z.infer<typeof SaveVersionParams>) {
  if (!world.def) {
    return fail(
      "no_workflow",
      "Write the Definition of Workflow first (update_workflow), then save a version."
    );
  }
  return withSavedVersion(world.def, params, boardLimits(world.board));
}

// ──────── tool.kanban.save_workflow_version ────────
registry.register({
  id: "tool.kanban.save_workflow_version",
  toolId: "tool.kanban",
  name: "save_workflow_version",
  category: "write",
  requiresConfirmation: false,
  description: `Save the Definition of Workflow as a numbered version, with the board's WIP limits at the time, so a later compare shows what changed (the latest ${WORKFLOW_VERSIONS_MAX} are kept). Params: {note?, expect? (what the team expects it to change)}. Returns {ok: true, version, savedAt} or {ok: false, error: "no_workflow", hint}.`,
  paramsSchema: SaveVersionParams,
  handler: async (params) => {
    const plan = planSaveVersion(browserWorld(), params);
    if ("ok" in plan) return plan;
    ws().upsertWorkflowDefinition(plan.def);
    return { ok: true, version: plan.version.version, savedAt: plan.version.savedAt };
  },
  mcpHandler: async (params, ctx) => {
    const plan = planSaveVersion(await serverWorld(ctx.userId, { stories: false }), params);
    if ("ok" in plan) return plan;
    await serverUpsertEntity<WorkflowDefinition>(ctx.userId, WORKFLOW_DEFINITION_KIND, plan.def);
    return { ok: true, version: plan.version.version, savedAt: plan.version.savedAt };
  },
});

const CompareParams = z.object({
  version: z.number().int().min(1).optional().describe("Default: the latest."),
  weeks: z
    .union([z.literal(2), z.literal(4), z.literal(8)])
    .optional()
    .describe("Weeks either side of the save. Default 4."),
});

function planCompare(world: WorkflowWorld, params: z.infer<typeof CompareParams>) {
  // The items and the WIP count read one board: the version's, else the described one.
  const board = compareBoard(world.def, params.version);
  if (!world.def?.versions?.length || !board) {
    return fail(
      "no_version",
      "Save a version of the Definition of Workflow first (save_workflow_version)."
    );
  }
  const items = workflowItems(board, {
    stories: world.stories,
    boards: world.board ? [world.board] : [],
  });
  const weeks: CompareWeeks = params.weeks ?? 4;
  const out = compareVersion(world.def, items, { version: params.version, weeks, board });
  if (!out) return fail("no_version", `There is no version ${params.version}.`);
  return { ok: true as const, board, ...out };
}

// ──────── tool.kanban.compare_workflow_version ────────
registry.register({
  id: "tool.kanban.compare_workflow_version",
  toolId: "tool.kanban",
  name: "compare_workflow_version",
  category: "read",
  description: `Compare the described board's flow in the weeks before a saved version of the Definition of Workflow with the weeks from its save day. Params: {version? (default the latest), weeks?: ${COMPARE_WEEKS.join(" | ")} (default 4)}. Returns {ok: true, board, version, weeks, before, after, cutShort (the after window stops at today)}; each side is {from, to, days, finished, enough, median, p85 (cycle days, null below 5 finished items), throughputPerWeek, avgWip}. Or {ok: false, error: "no_version", hint}.`,
  paramsSchema: CompareParams,
  handler: async (params) => planCompare(browserWorld(), params),
  mcpHandler: async (params, ctx) => planCompare(await serverWorld(ctx.userId), params),
});

const SetBlockedParams = z.object({
  cardId: z.string().min(1),
  blocked: z.boolean(),
  cause: z.string().max(200).optional().describe("What blocks it."),
  cluster: z
    .string()
    .max(BLOCKER_CLUSTER_MAX)
    .optional()
    .describe(
      "The blocker cluster: one of the defaults (such as 'Waiting for a review' or 'Another team') or the team's own."
    ),
});

/** The board with the card's flag set and its note written on the spell, or a refusal. */
export function planSetBlocked(
  board: KanbanBoard | null,
  params: z.infer<typeof SetBlockedParams>,
  at: string = new Date().toISOString()
): { board: KanbanBoard; card: KanbanCard } | Fail {
  if (isExampleId(params.cardId)) {
    return fail("example", "That is an example card: it isn't saved, so it has nothing to block.");
  }
  const card = board?.cards.find((c) => c.id === params.cardId);
  if (!board || !card) return fail("not_found", "No card with that id is on the Flow board.");
  if (card.column === "done" && params.blocked) {
    return fail("done", "A card in Done can't be blocked. Move it back first (move_card).");
  }
  const flagged: KanbanCard = { ...card };
  if (params.blocked) flagged.blocked = true;
  else delete flagged.blocked;
  const stamped = stampBoardBlocks(
    { ...board, cards: board.cards.map((c) => (c.id === card.id ? flagged : c)) },
    board,
    at
  );
  let next = stamped.cards.find((c) => c.id === card.id) as KanbanCard;
  const cause = params.cause?.trim();
  const cluster = params.cluster?.trim();
  if (cause || cluster) {
    const side = cluster ? defaultClusterSide(cluster) : null;
    // A note on an unblock goes on the spell it just closed.
    const log = next.blockLog ?? [];
    const spellFrom = params.blocked ? undefined : log[log.length - 1]?.from;
    if (params.blocked || spellFrom) {
      const noted = withSpellNote(
        next,
        { ...(cause ? { cause } : {}), ...(cluster ? { cluster } : {}), ...(side ? { side } : {}) },
        { at, ...(spellFrom ? { spellFrom } : {}) }
      );
      if (noted) next = noted;
    }
  }
  return {
    board: { ...stamped, cards: stamped.cards.map((c) => (c.id === card.id ? next : c)) },
    card: next,
  };
}

function setBlockedAnswer(card: KanbanCard) {
  const log = card.blockLog ?? [];
  return { ok: true as const, blocked: Boolean(card.blocked), spell: log[log.length - 1] ?? null };
}

// ──────── tool.kanban.set_blocked ────────
registry.register({
  id: "tool.kanban.set_blocked",
  toolId: "tool.kanban",
  name: "set_blocked",
  category: "write",
  requiresConfirmation: false,
  description:
    "Flag a Flow-board card blocked, or clear the flag, stamping its blocked spell as the page does (on: a spell opens now; off: the open one closes). cause (at most 200 characters) and cluster go on the spell (on an unblock, on the spell it just closed); a default cluster also sets its side (inside or outside the team). Refuses example cards and blocking a card in Done. Returns {ok: true, blocked, spell: {from, to?, cause?, cluster?, side?} | null} or {ok: false, error, hint}.",
  paramsSchema: SetBlockedParams,
  handler: async (params) => {
    const plan = planSetBlocked(browserBoard(), params);
    if ("ok" in plan) return plan;
    ws().upsertKanbanBoard(plan.board);
    const stored = browserBoard()?.cards.find((c) => c.id === params.cardId) ?? plan.card;
    return setBlockedAnswer(stored);
  },
  mcpHandler: async (params, ctx) => {
    const board = await serverGetEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, KANBAN_BOARD_ID);
    const plan = planSetBlocked(board, params);
    if ("ok" in plan) return plan;
    await serverUpsertEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, plan.board);
    return setBlockedAnswer(plan.card);
  },
});
