import type { HandoffLink, RetroBoard, RetroCard } from "@/lib/stores/workspace-types";

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

/** `a`'s links, then `b`'s to targets `a` doesn't link to. */
function mergedLinks(
  a: readonly HandoffLink[] = [],
  b: readonly HandoffLink[] = []
): HandoffLink[] {
  const out = [...a];
  for (const l of b) {
    if (!out.some((o) => o.route === l.route && o.targetId === l.targetId)) out.push(l);
  }
  return out;
}

/** An action with what its carried copy got since: done, an owner, a send. */
function foldCarriedCopy(original: RetroCard, copy: RetroCard): RetroCard {
  const sentTo = mergedLinks(original.sentTo, copy.sentTo);
  return {
    ...original,
    assignee: (copy.assignee ?? "").trim() ? copy.assignee : original.assignee,
    ...(copy.done && !original.done
      ? { done: true, ...(copy.doneAt ? { doneAt: copy.doneAt } : {}) }
      : {}),
    ...(sentTo.length > 0 ? { sentTo } : {}),
  };
}

/**
 * Undo of "New Retro": the board as it was before, with what changed since.
 * Its archived copy may have been edited in the meantime (an action marked
 * done in Retro Actions, a send from Past retros), so each card is taken
 * from the copy when the copy still has it. A board started since (a format
 * picked, a hand-off) keeps its cards: they are added after the old ones,
 * so nothing typed in the new board is lost. One in a column this board's
 * format lacks goes to the first column, as a carried-over action does
 * (else it would count but never show). A copy carried over from one of
 * this board's own actions folds back into it: the original is back, and
 * Retro Actions would hide it behind the copy. The timer comes back stopped.
 */
export function boardBeforeNewRetro(
  before: RetroBoard,
  archive: RetroBoard | undefined,
  startedSince: RetroBoard | undefined
): RetroBoard {
  const edited = new Map((archive?.cards ?? []).map((c) => [c.id, c]));
  const cards = before.cards.map((c) => edited.get(c.id) ?? c);
  const at = new Map(cards.map((c, i) => [c.id, i]));
  const keys = before.format.columns.map((col) => col.key);
  const folded = new Set<string>();
  for (const c of startedSince?.cards ?? []) {
    if (at.has(c.id)) continue;
    const original = c.carriedFrom ? at.get(c.carriedFrom) : undefined;
    if (original !== undefined) {
      cards[original] = foldCarriedCopy(cards[original], c);
      folded.add(c.id);
      continue;
    }
    cards.push(keys.length === 0 || keys.includes(c.columnKey) ? c : { ...c, columnKey: keys[0] });
  }
  // A card grouped under a folded copy stands on its own.
  const out =
    folded.size === 0
      ? cards
      : cards.map((c) =>
          c.groupedWith && folded.has(c.groupedWith) ? { ...c, groupedWith: null } : c
        );
  return { ...before, cards: out, timerRunning: false };
}

export function retroActionItems(board: RetroBoard): RetroCard[] {
  return board.cards.filter((c) => c.isActionItem);
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
