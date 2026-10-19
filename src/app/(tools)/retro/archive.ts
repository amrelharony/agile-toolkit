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

export function retroActionItems(board: RetroBoard): RetroCard[] {
  return board.cards.filter((c) => c.isActionItem);
}
