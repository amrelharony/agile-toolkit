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
 *
 * Entity kind "workspace:kanbanBoard" (camelCase via kindFromToolId) matches
 * the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import {
  KANBAN_BOARD_ID,
  type KanbanBoard,
  type KanbanCard,
  type KanbanColumnId,
} from "@/lib/stores/workspace-types";
import { cycleStats, KANBAN_HISTORY_CAP, movedCard, WORKING } from "@/lib/kanban/flow";

const KIND_KANBAN = "workspace:kanbanBoard";

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
    "Add a card to the board (defaults: column 'backlog', class 'standard'), optionally with an assignee and a blocked flag. Creates the board if absent. Returns {added: true, id}.",
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
    const board =
      (await serverGetEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, KANBAN_BOARD_ID)) ??
      emptyBoard();
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
  description: `Move a card to a column, stamped as the page does: columnSince always; startedAt on entering in_progress or review (dropped on going back to backlog or ready); completedAt on entering done (dropped on leaving it); entering done clears blocked; the move is appended to the card's history ({column, from, at}, oldest first, the latest ${KANBAN_HISTORY_CAP} kept), which the flow charts read. Returns {updated: true} or {updated: false} when the board/card is unknown.`,
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
    await serverUpsertEntity<KanbanBoard>(ctx.userId, KIND_KANBAN, next);
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
