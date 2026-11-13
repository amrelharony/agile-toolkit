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
 *   4. update   — edit an action's text, owner or due date in place.
 *   5. list_themes — what came up in three or more of the past retros
 *                 (lib/retro/recurring-themes), and what came back after
 *                 its action was marked done. Reads only.
 *
 * An action counts as done when it is marked on the card, or when the
 * impediment, Kanban card or story it was sent to is finished, as on the
 * page (a story it became in Sprint Planning closes it when that story is
 * done; a deleted story leaves it open).
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
  Story,
} from "@/lib/stores/workspace-types";
import {
  actionCard,
  collectRetroActions,
  followThroughByRetro,
  quickAddBoard,
  summarizeRetroActions,
  targetDoneIn,
  withActionDone,
  withActionPatch,
  withAddedAction,
  type RetroAction,
} from "@/lib/retro/actions";
import { todayIso } from "@/lib/sprints/series";
import {
  RECURRING_MIN_RETROS,
  archivedCards,
  archivedRetroCount,
  recurringThemes,
} from "@/lib/retro/recurring-themes";

const KIND_RETRO = "workspace:retroBoard";

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
        closedByTarget: a.closedByTarget,
        current: a.current,
        carriedFrom: a.carriedFrom ?? null,
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
    "List the team's retro action items across every retro (current board first, then archives newest first). An action is done when marked on the card or when the impediment, Kanban card or story it was sent to is finished (sentTo route impediment, kanban or backlog-story; a deleted story leaves it open). Returns {open, overdue, done, followThrough: {boardId, retroLabel, archivedAt, sprintId?, agreed, done, carried, open, rate | null}[] (past retros, oldest first), actions: {id, boardId, retro, text, assignee, dueDate, done, doneAt, overdue, closedByTarget (done because its impediment, Kanban card or story finished), current (on the current retro), carriedFrom (the action it was carried over from) | null, sentTo}[]}. Filter with status: open | overdue | done | all (default all).",
  paramsSchema: z.object({
    status: z.enum(["open", "overdue", "done", "all"]).optional(),
  }),
  handler: async (params) => {
    const s = ws();
    return listing(
      s.retroBoards ?? [],
      params.status,
      targetDoneIn({
        impediments: s.impediments,
        kanbanBoards: s.kanbanBoards,
        stories: s.stories,
      })
    );
  },
  mcpHandler: async (params, ctx) => {
    const [boards, impediments, kanbanBoards, stories] = await Promise.all([
      serverListEntities<RetroBoard>(ctx.userId, KIND_RETRO),
      serverListEntities<Impediment>(ctx.userId, "workspace:impediment"),
      serverListEntities<KanbanBoard>(ctx.userId, "workspace:kanbanBoard"),
      serverListEntities<Story>(ctx.userId, "workspace:story"),
    ]);
    return listing(boards, params.status, targetDoneIn({ impediments, kanbanBoards, stories }));
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

const UpdateParams = z.object({
  cardId: z.string().min(1).describe("The action item's card id (see list)."),
  text: z.string().trim().min(1).max(500).optional(),
  assignee: z.string().trim().max(60).nullable().optional().describe("null or empty clears it."),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .describe("YYYY-MM-DD; null clears it."),
});

function updated(boards: readonly RetroBoard[], params: z.infer<typeof UpdateParams>) {
  const board = boardWithAction(boards, params.cardId);
  if (!board) return null;
  const next = withActionPatch(board, params.cardId, {
    ...(params.text !== undefined ? { text: params.text.trim() } : {}),
    ...(params.assignee !== undefined ? { assignee: (params.assignee ?? "").trim() } : {}),
    ...(params.dueDate !== undefined ? { dueDate: params.dueDate ?? undefined } : {}),
  });
  return next;
}

// ──────── tool.retro_actions.update ────────
registry.register({
  id: "tool.retro_actions.update",
  toolId: "tool.retro_actions",
  name: "update",
  category: "write",
  requiresConfirmation: false,
  description:
    "Edit a retro action item on whichever retro holds it: text, assignee (owner; null or empty clears) and dueDate (YYYY-MM-DD; null clears). Fields left out stay as they are. Returns {updated: true, boardId}, or {updated: false} when no action item has that id.",
  paramsSchema: UpdateParams,
  handler: async (params) => {
    const next = updated(ws().retroBoards ?? [], params);
    if (!next) return { updated: false };
    ws().upsertRetroBoard(next);
    return { updated: true, boardId: next.id };
  },
  mcpHandler: async (params, ctx) => {
    const next = updated(await serverListEntities<RetroBoard>(ctx.userId, KIND_RETRO), params);
    if (!next) return { updated: false };
    await serverUpsertEntity<RetroBoard>(ctx.userId, KIND_RETRO, next);
    return { updated: true, boardId: next.id };
  },
});

/** The themes as list_themes reports them: each with its retros, a few cards, and came-back. */
function themesListing(boards: readonly RetroBoard[]) {
  const pastRetros = archivedRetroCount(boards);
  if (pastRetros < RECURRING_MIN_RETROS) {
    return { pastRetros, enough: false, minRetros: RECURRING_MIN_RETROS, themes: [] };
  }
  const cards = new Map(archivedCards(boards).map((c) => [c.card.id, c]));
  const archivedAt = new Map(boards.map((b) => [b.id, b.archivedAt ?? null]));
  return {
    pastRetros,
    enough: true,
    minRetros: RECURRING_MIN_RETROS,
    themes: recurringThemes(boards).map((t) => ({
      name: t.name,
      retros: t.boardIds.map((id) => ({ boardId: id, archivedAt: archivedAt.get(id) ?? null })),
      cardCount: t.cardIds.length,
      cards: t.cardIds.slice(0, 12).flatMap((id) => {
        const hit = cards.get(id);
        return hit ? [{ id, boardId: hit.board.id, text: hit.card.text }] : [];
      }),
      cameBackAfterDone: t.cameBack
        ? {
            actionId: t.cameBack.actionId,
            actionText: t.cameBack.actionText,
            doneAt: t.cameBack.doneAt,
            boardId: t.cameBack.boardId,
          }
        : null,
    })),
  };
}

// ──────── tool.retro_actions.list_themes ────────
registry.register({
  id: "tool.retro_actions.list_themes",
  toolId: "tool.retro_actions",
  name: "list_themes",
  category: "read",
  description:
    "Recurring themes across the past (archived) retros, up to 52: words the cards of three or more retros share, most retros first, each card in one theme at most (carried-over copies left out). A theme 'came back after done' when one of its cards is an action marked done and the theme came up again in a retro archived after that. Returns {pastRetros, enough (false below 3 past retros), minRetros, themes: {name, retros: {boardId, archivedAt}[] (oldest first), cardCount, cards: {id, boardId, text}[] (up to 12), cameBackAfterDone: {actionId, actionText, doneAt, boardId} | null}[]}.",
  paramsSchema: z.object({}),
  handler: async () => themesListing(ws().retroBoards ?? []),
  mcpHandler: async (_params, ctx) =>
    themesListing(await serverListEntities<RetroBoard>(ctx.userId, KIND_RETRO)),
});
