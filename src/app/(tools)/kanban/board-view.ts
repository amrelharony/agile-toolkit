/**
 * Which board /kanban opens on. Pure, so the choice is testable without a
 * browser.
 */

import { readSprintParam } from "@/lib/sprints/use-selected-sprint";

export type BoardView = "sprint" | "flow";

/** This viewer's last choice, kept in this browser only (a per-device preference). */
export const BOARD_VIEW_KEY = "agile-toolkit:kanban:board-view";

/** URL parameter naming a board: `/kanban?board=flow`. */
export const BOARD_PARAM = "board";

export function isBoardView(value: unknown): value is BoardView {
  return value === "sprint" || value === "flow";
}

/**
 * The board a link asks for: `?board=flow` or `?board=sprint`, and a
 * `?sprint=<id>` link (from the standup or the cockpit) means that
 * sprint's board. Null when the link names neither.
 */
export function linkedBoard(search: string): BoardView | null {
  const named = new URLSearchParams(search).get(BOARD_PARAM);
  if (isBoardView(named)) return named;
  return readSprintParam(search) ? "sprint" : null;
}

/**
 * A link's board, else the viewer's last choice, else the Sprint board
 * while a sprint is active and the Flow board otherwise, so a team without
 * sprints keeps the board it always had.
 */
export function pickBoardView(
  linked: BoardView | null,
  stored: unknown,
  hasActiveSprint: boolean
): BoardView {
  if (linked) return linked;
  if (isBoardView(stored)) return stored;
  return hasActiveSprint ? "sprint" : "flow";
}
