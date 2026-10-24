import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";

/**
 * Past retros.
 *
 * "New Retro" used to delete the board, and with it the action items the
 * team had just agreed. Now the finished board is copied to its own id with
 * `archivedAt` set before the current board ("retro:current", which the MCP
 * tools also address) is cleared. The latest archives are kept so the next
 * retro can open by checking last time's actions.
 */

/** Keep this many past retros; older ones are dropped when a new one is archived. */
export const RETRO_ARCHIVE_LIMIT = 20;

export function archivedRetroCopy(board: RetroBoard, now = new Date()): RetroBoard {
  const at = now.toISOString();
  return { ...board, id: `retro:${at}`, archivedAt: at, timerRunning: false };
}

/** Whether a board holds anything worth keeping. */
export function hasRetroContent(board: RetroBoard | null | undefined): board is RetroBoard {
  return Boolean(board && board.cards.length > 0);
}

/** Archived boards, newest first. */
export function pastRetros(boards: readonly RetroBoard[]): RetroBoard[] {
  return boards
    .filter((b) => typeof b.archivedAt === "string")
    .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
}

/** Ids to drop so that, after adding one more, at most `limit` archives remain. */
export function retroArchivesToPrune(
  boards: readonly RetroBoard[],
  limit = RETRO_ARCHIVE_LIMIT
): string[] {
  return pastRetros(boards)
    .slice(Math.max(0, limit - 1))
    .map((b) => b.id);
}

/**
 * Undo of "New Retro": the board as it was before, with what changed since.
 * Its archived copy may have been edited in the meantime (an action marked
 * done in Retro Actions, a send from Past retros), so each card is taken
 * from the copy when the copy still has it. A board started since (a format
 * picked, a hand-off) keeps its cards: they are added after the old ones,
 * so nothing typed in the new board is lost. The timer comes back stopped.
 */
export function boardBeforeNewRetro(
  before: RetroBoard,
  archive: RetroBoard | undefined,
  startedSince: RetroBoard | undefined
): RetroBoard {
  const edited = new Map((archive?.cards ?? []).map((c) => [c.id, c]));
  const cards = before.cards.map((c) => edited.get(c.id) ?? c);
  const ids = new Set(cards.map((c) => c.id));
  for (const c of startedSince?.cards ?? []) if (!ids.has(c.id)) cards.push(c);
  return { ...before, cards, timerRunning: false };
}

export function retroActionItems(board: RetroBoard): RetroCard[] {
  return board.cards.filter((c) => c.isActionItem);
}

/**
 * The retro this board follows: the archive named by `previousRetroId`, or
 * else the newest archive. Null when there is none.
 */
export function previousRetro(
  boards: readonly RetroBoard[],
  previousRetroId?: string
): RetroBoard | null {
  const past = pastRetros(boards);
  return (previousRetroId && past.find((b) => b.id === previousRetroId)) || past[0] || null;
}

/**
 * A carried-over copy of a previous retro's action: a new action item on the
 * current board, in the same column when this format has it (else the first
 * column). It keeps the assignee and where the action was already sent, so
 * it isn't sent to the same tool twice.
 */
export function carriedOverCard(
  action: RetroCard,
  columnKeys: readonly string[],
  id: string
): RetroCard {
  return {
    id,
    columnKey: columnKeys.includes(action.columnKey)
      ? action.columnKey
      : (columnKeys[0] ?? action.columnKey),
    text: action.text,
    votes: 0,
    groupedWith: null,
    isActionItem: true,
    assignee: action.assignee,
    discussing: false,
    ...(action.sentTo && action.sentTo.length > 0 ? { sentTo: action.sentTo } : {}),
    carriedFrom: action.id,
  };
}
