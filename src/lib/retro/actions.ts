/**
 * Retro action items across every retro — the current board and the
 * archives — as one list a Scrum master can follow up. Pure: the caller
 * supplies today's date and a way to ask a hand-off target whether it is
 * finished (an impediment resolved, a Kanban card in Done), so the page,
 * the cockpit and the agent read the same list.
 */

import type { HandoffLink, RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { pastRetros } from "@/app/(tools)/retro/archive";

/** MUST match RB_ID in src/app/(tools)/retro/retro-client.tsx. */
export const RETRO_CURRENT_ID = "retro:current";

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
 * first. An archived action that was carried over onto the current board
 * is left out: the carried copy is the live one.
 */
export function collectRetroActions(
  boards: readonly RetroBoard[],
  { today, targetDone }: CollectOptions
): RetroAction[] {
  const current = boards.find((b) => b.id === RETRO_CURRENT_ID && !b.archivedAt);
  const carried = new Set(
    (current?.cards ?? []).map((c) => c.carriedFrom).filter((id): id is string => Boolean(id))
  );
  const ordered = [...(current ? [current] : []), ...pastRetros(boards)];
  const out: RetroAction[] = [];
  for (const board of ordered) {
    const label = retroLabel(board);
    for (const card of board.cards) {
      if (!card.isActionItem) continue;
      if (board.archivedAt && carried.has(card.id)) continue;
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

export type RetroActionPatch = Partial<Pick<RetroCard, "done" | "doneAt" | "dueDate" | "assignee">>;

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
