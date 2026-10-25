/**
 * Retro action items across every retro — the current board and the
 * archives — as one list a Scrum master can follow up. Pure: the caller
 * supplies today's date and a way to ask a hand-off target whether it is
 * finished (an impediment resolved, a Kanban card in Done), so the page,
 * the cockpit and the agent read the same list.
 */

import type { HandoffLink, RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { pastRetros } from "@/app/(tools)/retro/archive";
import { isExampleId } from "@/lib/utils/example-id";
import { RETRO_CARD_MAX, RETRO_CURRENT_ID, newestArchivedRetro } from "./board";

export { RETRO_CURRENT_ID };

/**
 * Whether a card is the team's: example cards loaded onto a real board are
 * not. An example board (a tool's read-only preview) is read as it is.
 */
function isTeamCard(board: Pick<RetroBoard, "id">, card: Pick<RetroCard, "id">): boolean {
  return isExampleId(board.id) || !isExampleId(card.id);
}

/** Ids of cards that were carried onto a later board, anywhere: the later copy is the live one. */
function carriedIds(boards: readonly RetroBoard[]): Set<string> {
  const out = new Set<string>();
  for (const b of boards) for (const c of b.cards) if (c.carriedFrom) out.add(c.carriedFrom);
  return out;
}

export interface RetroAction {
  /** The card id. */
  id: string;
  boardId: string;
  /** "Current retro", or the archived retro's format and date. */
  retroLabel: string;
  /** When the retro was archived; absent on the current board. */
  archivedAt?: string;
  current: boolean;
  text: string;
  assignee: string;
  dueDate?: string;
  /** Marked done on the card. */
  done: boolean;
  doneAt?: string;
  /** Done because a linked target finished (not marked on the card). */
  closedByTarget: boolean;
  /** Open and past its due date. */
  overdue: boolean;
  sentTo: HandoffLink[];
  carriedFrom?: string;
}

export interface CollectOptions {
  /** YYYY-MM-DD, local. */
  today: string;
  /** Whether a hand-off target has finished; false when unknown. */
  targetDone?: (link: HandoffLink) => boolean;
}

function retroLabel(board: RetroBoard): string {
  if (!board.archivedAt) return "Current retro";
  const name = board.format?.name ?? "Retro";
  const d = new Date(board.archivedAt);
  const day = Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";
  return day ? `${name} · ${day}` : name;
}

/** Whether an action counts as finished: marked done, or its target is. */
export function isActionDone(
  card: RetroCard,
  targetDone?: (link: HandoffLink) => boolean
): boolean {
  if (card.done) return true;
  return Boolean(targetDone && (card.sentTo ?? []).some((l) => targetDone(l)));
}

/**
 * Every action item, the current board's first, then the archives newest
 * first. An action that was carried onto a later board (the current one or
 * an archive) is left out: the carried copy is the live one. Example cards
 * on a real board are left out too.
 */
export function collectRetroActions(
  boards: readonly RetroBoard[],
  { today, targetDone }: CollectOptions
): RetroAction[] {
  const current = boards.find((b) => b.id === RETRO_CURRENT_ID && !b.archivedAt);
  const carried = carriedIds(boards);
  const ordered = [...(current ? [current] : []), ...pastRetros(boards)];
  const out: RetroAction[] = [];
  for (const board of ordered) {
    const label = retroLabel(board);
    for (const card of board.cards) {
      if (!card.isActionItem || !isTeamCard(board, card)) continue;
      if (carried.has(card.id)) continue;
      const closedByTarget = !card.done && isActionDone(card, targetDone);
      const done = card.done === true || closedByTarget;
      out.push({
        id: card.id,
        boardId: board.id,
        retroLabel: label,
        archivedAt: board.archivedAt,
        current: !board.archivedAt,
        text: card.text,
        assignee: card.assignee ?? "",
        dueDate: card.dueDate,
        done,
        doneAt: card.doneAt,
        closedByTarget,
        overdue: !done && typeof card.dueDate === "string" && card.dueDate < today,
        sentTo: card.sentTo ?? [],
        carriedFrom: card.carriedFrom,
      });
    }
  }
  return out;
}

export interface RetroActionSummary {
  open: number;
  overdue: number;
  done: number;
}

export function summarizeRetroActions(actions: readonly RetroAction[]): RetroActionSummary {
  let open = 0;
  let overdue = 0;
  let done = 0;
  for (const a of actions) {
    if (a.done) done++;
    else {
      open++;
      if (a.overdue) overdue++;
    }
  }
  return { open, overdue, done };
}

export type RetroActionPatch = Partial<
  Pick<RetroCard, "done" | "doneAt" | "dueDate" | "assignee" | "text">
>;

/**
 * The board with `patch` applied to one card. A field set to `undefined` is
 * removed. Returns null when the card isn't on the board.
 */
export function withActionPatch(
  board: RetroBoard,
  cardId: string,
  patch: RetroActionPatch
): RetroBoard | null {
  if (!board.cards.some((c) => c.id === cardId)) return null;
  return {
    ...board,
    cards: board.cards.map((c) => {
      if (c.id !== cardId) return c;
      const next: RetroCard = { ...c };
      for (const [key, value] of Object.entries(patch) as [keyof RetroActionPatch, unknown][]) {
        if (value === undefined) delete next[key];
        else (next as unknown as Record<string, unknown>)[key] = value;
      }
      return next;
    }),
  };
}

/** Mark an action done (or open again), stamping `doneAt`. */
export function withActionDone(
  board: RetroBoard,
  cardId: string,
  done: boolean,
  now: string = new Date().toISOString()
): RetroBoard | null {
  return withActionPatch(
    board,
    cardId,
    done ? { done: true, doneAt: now } : { done: undefined, doneAt: undefined }
  );
}

/* ── Follow-through per retro ─────────────────────────────────────────── */

export interface RetroFollowThrough {
  boardId: string;
  retroLabel: string;
  archivedAt?: string;
  sprintId?: string;
  /** Action items agreed on that board (example cards on a real board left out). */
  agreed: number;
  /** Done on the card, by its hand-off target, or through a carried copy that got done. */
  done: number;
  /** Not done, but carried onto a later board. */
  carried: number;
  /** agreed − done − carried. */
  open: number;
  /** done ÷ agreed; null when nothing was agreed. */
  rate: number | null;
}

/**
 * How each archived retro's actions turned out, oldest first: a Scrum
 * master's "do we do what we agree?". An action carried onto a later board
 * counts as done when a copy down the chain got done, else as carried.
 */
export function followThroughByRetro(
  boards: readonly RetroBoard[],
  opts: { targetDone?: (link: HandoffLink) => boolean } = {}
): RetroFollowThrough[] {
  const copies = new Map<string, RetroCard[]>();
  for (const b of boards) {
    for (const c of b.cards) {
      if (!c.carriedFrom) continue;
      copies.set(c.carriedFrom, [...(copies.get(c.carriedFrom) ?? []), c]);
    }
  }
  const doneDownChain = (card: RetroCard, seen: Set<string>): boolean => {
    if (isActionDone(card, opts.targetDone)) return true;
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return (copies.get(card.id) ?? []).some((c) => doneDownChain(c, seen));
  };
  return [...pastRetros(boards)].reverse().map((board) => {
    let agreed = 0;
    let done = 0;
    let carried = 0;
    for (const card of board.cards) {
      if (!card.isActionItem || !isTeamCard(board, card)) continue;
      agreed++;
      if (doneDownChain(card, new Set())) done++;
      else if (copies.has(card.id)) carried++;
    }
    return {
      boardId: board.id,
      retroLabel: retroLabel(board),
      archivedAt: board.archivedAt,
      ...(board.sprintId ? { sprintId: board.sprintId } : {}),
      agreed,
      done,
      carried,
      open: agreed - done - carried,
      rate: agreed > 0 ? done / agreed : null,
    };
  });
}

/* ── Adding an action outside the board ───────────────────────────────── */

export interface NewRetroAction {
  text: string;
  assignee?: string;
  /** "YYYY-MM-DD". */
  dueDate?: string;
}

/** An action-item card for `input` in `columnKey`. */
export function actionCard(
  input: NewRetroAction,
  columnKey: string,
  id: string = crypto.randomUUID()
): RetroCard {
  const assignee = (input.assignee ?? "").trim();
  return {
    id,
    columnKey,
    text: input.text.trim().slice(0, RETRO_CARD_MAX),
    votes: 0,
    groupedWith: null,
    isActionItem: true,
    assignee,
    discussing: false,
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
  };
}

/**
 * The board a quick-added action goes on: the current retro while there is
 * one, else the newest archived retro (the one being followed up). None:
 * there is no retro to add it to.
 */
export function quickAddBoard(boards: readonly RetroBoard[]): RetroBoard | undefined {
  return (
    boards.find((b) => b.id === RETRO_CURRENT_ID && !b.archivedAt) ?? newestArchivedRetro(boards)
  );
}

/** The board with `card` added at the end. */
export function withAddedAction(board: RetroBoard, card: RetroCard): RetroBoard {
  return { ...board, cards: [...board.cards, card] };
}
