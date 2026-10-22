/**
 * Hand-off target: a card in the Kanban backlog.
 *
 * Appends to the board singleton (`kanban:current`) the same card
 * `tool.kanban.add_card` makes with its defaults (backlog column, standard
 * class, date-only createdAt), plus `sourceRef`. The board is read fresh
 * right before the write, so a card added a moment ago isn't dropped.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { KanbanBoard, KanbanCard } from "@/lib/stores/workspace-types";
import type { HandoffRoute, HandoffSource } from "../types";

/** MUST match KB_ID in kanban-client.tsx and src/lib/actions/tools/kanban.ts. */
export const KANBAN_BOARD_ID = "kanban:current";

function emptyBoard(): KanbanBoard {
  return {
    id: KANBAN_BOARD_ID,
    cards: [],
    wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
  };
}

function currentBoard(): KanbanBoard | undefined {
  return (useWorkspaceStore.getState().kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID);
}

export function buildKanbanCard(src: HandoffSource, id = crypto.randomUUID()): KanbanCard {
  // Same caps as the board's own add form.
  const description = (src.description ?? "").trim().slice(0, 4000) || undefined;
  return {
    id,
    title: src.title.trim().slice(0, 240),
    description,
    column: "backlog",
    class: "standard",
    createdAt: new Date().toISOString().slice(0, 10),
    startedAt: undefined,
    completedAt: undefined,
    sourceRef: src.sourceRef,
  };
}

export const kanbanRoute: HandoffRoute = {
  id: "kanban",
  label: "Kanban card",
  doneLabel: "Added to the Kanban backlog",
  targetToolId: "kanban",
  targetHref: () => "/kanban",
  send: (src) => {
    const card = buildKanbanCard(src);
    const board = currentBoard() ?? emptyBoard();
    useWorkspaceStore.getState().upsertKanbanBoard({ ...board, cards: [...board.cards, card] });
    return card.id;
  },
  remove: (id) => {
    const board = currentBoard();
    if (!board || !board.cards.some((c) => c.id === id)) return;
    useWorkspaceStore
      .getState()
      .upsertKanbanBoard({ ...board, cards: board.cards.filter((c) => c.id !== id) });
  },
  exists: (id) => Boolean(currentBoard()?.cards.some((c) => c.id === id)),
  isDone: (id) => currentBoard()?.cards.find((c) => c.id === id)?.column === "done",
};
