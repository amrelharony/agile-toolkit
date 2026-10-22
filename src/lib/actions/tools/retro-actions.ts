/**
 * Retro Actions — tool-local actions.
 *
 * Category: Ceremonies
 *
 * Agent surface: tool.retro_actions.*
 * Backing CRUD : workspace.retro_board.* (the actions live on retro boards:
 *                the current one and the archives).
 *
 *   1. list     — every action item across retros with owner, due date,
 *                 done and overdue, plus the open/overdue/done counts.
 *   2. complete — mark an action done (or open again) on whichever board
 *                 holds it.
 *
 * "Done" here is what is marked on the card. The page also treats an action
 * as done when the impediment or Kanban card it was sent to is finished;
 * that needs the browser's hand-off routes, so it isn't mirrored here.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import type { RetroBoard } from "@/lib/stores/workspace-types";
import {
  collectRetroActions,
  summarizeRetroActions,
  withActionDone,
  type RetroAction,
} from "@/lib/retro/actions";
import { todayIso } from "@/lib/sprints/series";

const KIND_RETRO = "workspace:retroBoard";

const ws = () => useWorkspaceStore.getState();

type Status = "open" | "overdue" | "done" | "all";

function matches(a: RetroAction, status: Status): boolean {
  if (status === "open") return !a.done;
  if (status === "overdue") return a.overdue;
  if (status === "done") return a.done;
  return true;
}

function listing(boards: readonly RetroBoard[], status: Status = "all") {
  const all = collectRetroActions(boards, { today: todayIso() });
  return {
    ...summarizeRetroActions(all),
    actions: all
      .filter((a) => matches(a, status))
      .map((a) => ({
        id: a.id,
        boardId: a.boardId,
        retro: a.retroLabel,
        text: a.text,
        assignee: a.assignee,
        dueDate: a.dueDate ?? null,
        done: a.done,
        doneAt: a.doneAt ?? null,
        overdue: a.overdue,
        sentTo: a.sentTo,
      })),
  };
}

function boardWithAction(boards: readonly RetroBoard[], cardId: string): RetroBoard | undefined {
  return boards.find((b) => b.cards.some((c) => c.id === cardId && c.isActionItem));
}

// ──────── tool.retro_actions.list ────────
registry.register({
  id: "tool.retro_actions.list",
  toolId: "tool.retro_actions",
  name: "list",
  category: "read",
  description:
    "List the team's retro action items across every retro (current board first, then archives newest first). Returns {open, overdue, done, actions: {id, boardId, retro, text, assignee, dueDate, done, doneAt, overdue, sentTo}[]}. Filter with status: open | overdue | done | all (default all).",
  paramsSchema: z.object({
    status: z.enum(["open", "overdue", "done", "all"]).optional(),
  }),
  handler: async (params) => listing(ws().retroBoards ?? [], params.status),
  mcpHandler: async (params, ctx) =>
    listing(await serverListEntities<RetroBoard>(ctx.userId, KIND_RETRO), params.status),
});

// ──────── tool.retro_actions.complete ────────
registry.register({
  id: "tool.retro_actions.complete",
  toolId: "tool.retro_actions",
  name: "complete",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark a retro action item done (default) or open again (done: false), on whichever retro board holds it. Returns {updated: false} when no action item has that id, else {updated: true, boardId, done}.",
  paramsSchema: z.object({
    cardId: z.string().min(1).describe("The action item's card id (see list)."),
    done: z.boolean().optional(),
  }),
  handler: async (params) => {
    const board = boardWithAction(ws().retroBoards ?? [], params.cardId);
    const done = params.done ?? true;
    const next = board && withActionDone(board, params.cardId, done);
    if (!board || !next) return { updated: false };
    ws().upsertRetroBoard(next);
    return { updated: true, boardId: board.id, done };
  },
  mcpHandler: async (params, ctx) => {
    const boards = await serverListEntities<RetroBoard>(ctx.userId, KIND_RETRO);
    const board = boardWithAction(boards, params.cardId);
    const done = params.done ?? true;
    const next = board && withActionDone(board, params.cardId, done);
    if (!board || !next) return { updated: false };
    await serverUpsertEntity<RetroBoard>(ctx.userId, KIND_RETRO, next);
    return { updated: true, boardId: board.id, done };
  },
});
