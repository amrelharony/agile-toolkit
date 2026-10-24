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
 *                 done and overdue, plus the open/overdue/done counts and
 *                 the follow-through of each past retro.
 *   2. complete — mark an action done (or open again) on whichever board
 *                 holds it.
 *   3. add      — add an action outside the board (the page's quick add):
 *                 onto the current retro, else the newest archived one.
 *
 * An action counts as done when it is marked on the card, or when the
 * impediment or Kanban card it was sent to is finished, as on the page.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import type {
  HandoffLink,
  Impediment,
  KanbanBoard,
  RetroBoard,
} from "@/lib/stores/workspace-types";
import {
  actionCard,
  collectRetroActions,
  followThroughByRetro,
  quickAddBoard,
  summarizeRetroActions,
  withActionDone,
  withAddedAction,
  type RetroAction,
} from "@/lib/retro/actions";
import { isResolved } from "@/lib/impediments/model";
import { todayIso } from "@/lib/sprints/series";

const KIND_RETRO = "workspace:retroBoard";

/**
 * Whether an action's hand-off target is finished, as the page reads it: an
 * impediment resolved, a Kanban card in Done.
 */
function targetDoneFrom(
  impediments: readonly Impediment[],
  boards: readonly KanbanBoard[]
): (link: HandoffLink) => boolean {
  return (link) => {
    if (link.route === "impediment") {
      const i = impediments.find((x) => x.id === link.targetId);
      return Boolean(i && isResolved(i));
    }
    if (link.route === "kanban") {
      return boards.some((b) => b.cards.some((c) => c.id === link.targetId && c.column === "done"));
    }
    return false;
  };
}

const ws = () => useWorkspaceStore.getState();

type Status = "open" | "overdue" | "done" | "all";

function matches(a: RetroAction, status: Status): boolean {
  if (status === "open") return !a.done;
  if (status === "overdue") return a.overdue;
  if (status === "done") return a.done;
  return true;
}

function listing(
  boards: readonly RetroBoard[],
  status: Status = "all",
  targetDone?: (link: HandoffLink) => boolean
) {
  const all = collectRetroActions(boards, { today: todayIso(), targetDone });
  return {
    ...summarizeRetroActions(all),
    followThrough: followThroughByRetro(boards, { targetDone }),
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
    "List the team's retro action items across every retro (current board first, then archives newest first). An action is done when marked on the card or when the impediment or Kanban card it was sent to is finished. Returns {open, overdue, done, followThrough: {boardId, retroLabel, archivedAt, sprintId?, agreed, done, carried, open, rate | null}[] (past retros, oldest first), actions: {id, boardId, retro, text, assignee, dueDate, done, doneAt, overdue, sentTo}[]}. Filter with status: open | overdue | done | all (default all).",
  paramsSchema: z.object({
    status: z.enum(["open", "overdue", "done", "all"]).optional(),
  }),
  handler: async (params) => {
    const s = ws();
    return listing(
      s.retroBoards ?? [],
      params.status,
      targetDoneFrom(s.impediments ?? [], s.kanbanBoards ?? [])
    );
  },
  mcpHandler: async (params, ctx) => {
    const [boards, impediments, kanban] = await Promise.all([
      serverListEntities<RetroBoard>(ctx.userId, KIND_RETRO),
      serverListEntities<Impediment>(ctx.userId, "workspace:impediment"),
      serverListEntities<KanbanBoard>(ctx.userId, "workspace:kanbanBoard"),
    ]);
    return listing(boards, params.status, targetDoneFrom(impediments, kanban));
  },
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

const AddParams = z.object({
  text: z.string().trim().min(1).max(500),
  assignee: z.string().trim().max(60).optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("YYYY-MM-DD."),
  boardId: z
    .string()
    .min(1)
    .optional()
    .describe("The retro to add it to. Default: the current retro, else the newest archived one."),
});

function addTo(boards: readonly RetroBoard[], params: z.infer<typeof AddParams>) {
  const board = params.boardId
    ? boards.find((b) => b.id === params.boardId)
    : quickAddBoard(boards);
  if (!board) return { error: "no_retro" as const };
  const columnKey = board.format?.columns?.[0]?.key ?? "start";
  const card = actionCard(params, columnKey);
  return { board: withAddedAction(board, card), id: card.id };
}

// ──────── tool.retro_actions.add ────────
registry.register({
  id: "tool.retro_actions.add",
  toolId: "tool.retro_actions",
  name: "add",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a retro action item outside the board meeting, as the page's quick add does: onto boardId, else the current retro, else the newest archived one (in its first column). Returns {added: true, id, boardId}, or {added: false, reason: 'no_retro'}.",
  paramsSchema: AddParams,
  handler: async (params) => {
    const r = addTo(ws().retroBoards ?? [], params);
    if ("error" in r) return { added: false, reason: r.error };
    ws().upsertRetroBoard(r.board);
    return { added: true, id: r.id, boardId: r.board.id };
  },
  mcpHandler: async (params, ctx) => {
    const r = addTo(await serverListEntities<RetroBoard>(ctx.userId, KIND_RETRO), params);
    if ("error" in r) return { added: false, reason: r.error };
    await serverUpsertEntity<RetroBoard>(ctx.userId, KIND_RETRO, r.board);
    return { added: true, id: r.id, boardId: r.board.id };
  },
});
