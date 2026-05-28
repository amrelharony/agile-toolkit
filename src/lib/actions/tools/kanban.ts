/**
 * Kanban Board — tool-local actions.
 *
 * Category: Flow & Delivery (squad S6)
 * Agent surface: tool.kanban.*
 * Backing CRUD : workspace.kanban_board.* (auto-generated). Singleton: one
 *                board document under a fixed id.
 *
 *   1. list_state — per-column counts, WIP-limit breaches, and average
 *      cycle time of done cards (startedAt → completedAt).
 *   2. add_card   — add a card (defaults: backlog column, standard class).
 *   3. move_card  — move a card to a column; stamps startedAt on first entry
 *      to in_progress and completedAt on entry to done.
 *
 * Entity kind "workspace:kanbanBoard" (camelCase via kindFromToolId) matches
 * the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { KanbanBoard, KanbanCard, KanbanColumnId } from "@/lib/stores/workspace-types";

const KIND_KANBAN = "workspace:kanbanBoard";
// MUST match KB_ID in kanban-client.tsx.
const KB_ID = "kanban:current";

const COLUMNS: KanbanColumnId[] = ["backlog", "ready", "in_progress", "review", "done"];

const ws = () => useWorkspaceStore.getState();

function emptyBoard(): KanbanBoard {
  return {
    id: KB_ID,
    cards: [],
    wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
  };
}

function browserBoard(): KanbanBoard | null {
  return (ws().kanbanBoards ?? []).find((b) => b.id === KB_ID) ?? null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function summarize(board: KanbanBoard | null) {
  if (!board) {
    return { exists: false, totalCards: 0, byColumn: {}, wipBreaches: [], avgCycleTimeDays: null };
  }
  const byColumn: Record<string, number> = {};
  for (const c of COLUMNS) byColumn[c] = 0;
  for (const card of board.cards) byColumn[card.column] = (byColumn[card.column] ?? 0) + 1;
  // WIP breach: a column whose limit > 0 and current count exceeds it.
  const wipBreaches = COLUMNS.filter(
    (c) => (board.wipLimits[c] ?? 0) > 0 && byColumn[c] > board.wipLimits[c]
  ).map((c) => ({ column: c, count: byColumn[c], limit: board.wipLimits[c] }));
  // Cycle time of done cards with both timestamps.
  const cycleTimes = board.cards
    .filter((c) => c.startedAt && c.completedAt)
    .map((c) => (Date.parse(c.completedAt!) - Date.parse(c.startedAt!)) / 86_400_000)
    .filter((d) => Number.isFinite(d) && d >= 0);
  const avgCycleTimeDays =
    cycleTimes.length > 0
      ? Math.round((cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) * 10) / 10
      : null;
  return { exists: true, totalCards: board.cards.length, byColumn, wipBreaches, avgCycleTimeDays };
}

// ──────── tool.kanban.list_state ────────
registry.register({
  id: "tool.kanban.list_state",
  toolId: "tool.kanban",
  name: "list_state",
  category: "read",
  description:
    "Summarise the kanban board. Returns {exists, totalCards, byColumn: {column: count}, wipBreaches: {column, count, limit}[], avgCycleTimeDays (done cards with startedAt→completedAt) | null}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserBoard()),
  mcpHandler: async (_params, ctx) => {
    const board = await serverGetEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, KB_ID);
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
    "Add a card to the board (defaults: column 'backlog', class 'standard'). Creates the board if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    column: ColumnEnum.optional(),
    class: ClassEnum.optional(),
  }),
  handler: async (params) => {
    const board = browserBoard() ?? emptyBoard();
    const card = newCard(params);
    ws().upsertKanbanBoard({ ...board, cards: [...board.cards, card] });
    return { added: true, id: card.id };
  },
  mcpHandler: async (params, ctx) => {
    const board =
      (await serverGetEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, KB_ID)) ?? emptyBoard();
    const card = newCard(params);
    await serverUpsertEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, {
      ...board,
      cards: [...board.cards, card],
    });
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
  description:
    "Move a card to a column. Stamps startedAt on first move into in_progress and completedAt on move into done. Returns {updated: true} or {updated: false} when the board/card is unknown.",
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
    const board = await serverGetEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, KB_ID);
    if (!board) return { updated: false };
    const next = moveCard(board, params.cardId, params.column);
    if (!next) return { updated: false };
    await serverUpsertEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, next);
    return { updated: true };
  },
});

function newCard(params: {
  title: string;
  description?: string;
  column?: KanbanColumnId;
  class?: KanbanCard["class"];
}): KanbanCard {
  const column = params.column ?? "backlog";
  return {
    id: crypto.randomUUID(),
    title: params.title,
    description: params.description,
    column,
    class: params.class ?? "standard",
    createdAt: today(),
    startedAt: column === "in_progress" ? today() : undefined,
    completedAt: column === "done" ? today() : undefined,
  };
}

/** Return a new board with the card moved, or null if the card isn't found. */
function moveCard(board: KanbanBoard, cardId: string, column: KanbanColumnId): KanbanBoard | null {
  if (!board.cards.some((c) => c.id === cardId)) return null;
  return {
    ...board,
    cards: board.cards.map((c) => {
      if (c.id !== cardId) return c;
      return {
        ...c,
        column,
        startedAt: column === "in_progress" && !c.startedAt ? today() : c.startedAt,
        completedAt: column === "done" && !c.completedAt ? today() : c.completedAt,
      };
    }),
  };
}
