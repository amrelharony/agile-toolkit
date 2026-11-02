/**
 * The current retro board as a hand-off target, shared by the retro-topic
 * and retro-action routes: a card appended to the board under
 * `retro:current`, in the column its tone fits.
 *
 * With no current retro, the send starts one in the first format (Start /
 * Stop / Continue), following the newest archived retro the way the Retro
 * tool's format picker does, so the item is waiting when the team meets.
 * Undo of that send removes the board again if nothing else was added.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { retroFormats, type RetroFormat } from "@/lib/constants/retro-formats";
import {
  RETRO_CARD_MAX,
  RETRO_CURRENT_ID,
  blankRetroBoard,
  newestArchivedRetro,
} from "@/lib/retro/board";
import type { HandoffSource } from "../types";

/** The current retro's id (lib/retro/board). */
export const RETRO_BOARD_ID = RETRO_CURRENT_ID;

export { RETRO_CARD_MAX };

/**
 * Column keys for each tone, best first; a format without any uses its first
 * column. A question is neither good nor bad news, so it goes where a team talks
 * things over (To Discuss, Learned, Island, Improve, Start), never into Stop,
 * Mad or Drop; on Mad, Sad, Glad it takes Glad.
 */
const COLUMN_PREFERENCE: Record<NonNullable<HandoffSource["tone"]>, readonly string[]> = {
  concern: ["to-discuss", "lacked", "anchor", "sad", "improve", "less-of", "stop", "mad", "rocks"],
  appreciation: ["glad", "liked", "keep", "continue", "wind", "more-of", "to-discuss"],
  question: ["to-discuss", "learned", "island", "improve", "start", "glad"],
};

/** The column a card of `tone` goes in on a board of `format`. */
export function retroColumnFor(
  format: Pick<RetroFormat, "columns"> | undefined,
  tone: HandoffSource["tone"] = "concern"
): string {
  const keys = (format?.columns ?? []).map((c) => c.key);
  return COLUMN_PREFERENCE[tone].find((k) => keys.includes(k)) ?? keys[0] ?? "start";
}

/** The board under the current retro's id (by id alone, so a send never replaces that row). */
export function currentRetroBoard(): RetroBoard | undefined {
  return (useWorkspaceStore.getState().retroBoards ?? []).find((b) => b.id === RETRO_BOARD_ID);
}

/** A new current board, as the Retro tool's format picker starts one. */
function newBoard(): RetroBoard {
  const previous = newestArchivedRetro(useWorkspaceStore.getState().retroBoards ?? []);
  return blankRetroBoard(retroFormats[0], previous ? { previousRetroId: previous.id } : {});
}

/** Cards whose send started the board (Undo takes the board away with them). */
const startedBoardFor = new Set<string>();

export function buildRetroCard(
  src: HandoffSource,
  format: Pick<RetroFormat, "columns"> | undefined,
  action: boolean,
  id = crypto.randomUUID()
): RetroCard {
  return {
    id,
    columnKey: retroColumnFor(format, src.tone),
    text: src.title.trim().slice(0, RETRO_CARD_MAX),
    votes: 0,
    groupedWith: null,
    isActionItem: action,
    assignee: action ? (src.owner ?? "").trim() : "",
    discussing: false,
    sourceRef: src.sourceRef,
  };
}

/** Append a card for `src` to the current board (starting one if needed); returns its id. */
export function addRetroCard(src: HandoffSource, action: boolean): string {
  const existing = currentRetroBoard();
  const board = existing ?? newBoard();
  const card = buildRetroCard(src, board.format, action);
  useWorkspaceStore.getState().upsertRetroBoard({ ...board, cards: [...board.cards, card] });
  if (!existing) startedBoardFor.add(card.id);
  return card.id;
}

/**
 * The card on any board: an archived copy keeps its cards' ids, so a sent
 * item is still found (and its link still live) after New Retro.
 */
export function findRetroCard(id: string): RetroCard | undefined {
  for (const b of useWorkspaceStore.getState().retroBoards ?? []) {
    const card = b.cards.find((c) => c.id === id);
    if (card) return card;
  }
  return undefined;
}

/** Remove the card; and the board, when this card's send started it and it is empty again. */
export function removeRetroCard(id: string): void {
  const board = currentRetroBoard();
  const started = startedBoardFor.delete(id);
  if (!board || !board.cards.some((c) => c.id === id)) return;
  const cards = board.cards.filter((c) => c.id !== id);
  if (started && cards.length === 0) useWorkspaceStore.getState().removeRetroBoard(RETRO_BOARD_ID);
  else useWorkspaceStore.getState().upsertRetroBoard({ ...board, cards });
}
