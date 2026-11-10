import type { RetroAction } from "@/lib/retro/actions";

export const ACTIONS_CSV_HEADERS = ["Summary", "Assignee", "Due date", "Done"];

/** One line, trimmed: an action typed over two lines stays one row. */
const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ").trim();

/**
 * The action list as a spreadsheet, for the Export menu's CSV option: one
 * row per action in the page's order, with the columns a tracker's import
 * asks for. An action with no owner or no due date has a blank cell, and
 * one finished through a linked impediment, Kanban card or story counts as done,
 * as on the page.
 */
export function actionsToCsv(actions: readonly RetroAction[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: ACTIONS_CSV_HEADERS,
    rows: actions.map((a) => [
      oneLine(a.text),
      a.assignee.trim(),
      a.dueDate ?? "",
      a.done ? "Yes" : "No",
    ]),
  };
}
