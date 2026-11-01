/**
 * CSV → WhiteboardTable converter for the import-modal flow.
 *
 * The parsing is lib/utils/csv's (shared with the other CSV imports):
 * optional header row, quoted cells with embedded commas / quotes / line
 * breaks, CRLF / LF / CR line endings, a byte-order mark.
 *
 * Empty trailing rows / fully-blank rows are dropped. Ragged rows
 * (shorter than the longest row) are padded with "" so the table
 * column count stays consistent.
 */

import { wbId } from "./clipboard";
import { padRows, parseCsv as parseCsvCells } from "@/lib/utils/csv";
import type { WhiteboardObject, WhiteboardTable } from "@/lib/stores/workspace-types";

/**
 * Parse a CSV string into a 2D array for a table: lib/utils/csv's rows,
 * padded to the widest one. Comma-separated only; a tab-separated paste
 * stays one column per line, as before.
 */
export function parseCsv(input: string): string[][] {
  return padRows(parseCsvCells(input));
}

/**
 * Build a WhiteboardTable from parsed rows. `worldOrigin` is the
 * top-left corner; the table sizes itself to ~120 px per column
 * (clamped to 480..1200 px total) and 32 px per row (clamped to
 * 96..640 px total).
 */
export function rowsToTable(
  rows: string[][],
  boardId: string,
  worldOrigin: { x: number; y: number },
  options: { headerRow?: boolean; z?: number } = {}
): WhiteboardTable | null {
  if (rows.length === 0 || rows[0].length === 0) return null;
  const cols = rows[0].length;
  const headerRow = options.headerRow ?? true;
  const w = Math.min(1200, Math.max(480, cols * 120));
  const h = Math.min(640, Math.max(96, rows.length * 32));
  const now = new Date().toISOString();
  return {
    id: wbId("wb"),
    boardId,
    type: "table",
    x: worldOrigin.x,
    y: worldOrigin.y,
    w,
    h,
    z: options.z ?? 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
    rows,
    headerRow,
  };
}

/**
 * One-shot CSV-string → committed-table-object helper. Returns null
 * when parsing yields no usable rows.
 */
export function csvToTable(
  csv: string,
  boardId: string,
  worldOrigin: { x: number; y: number },
  options: { headerRow?: boolean; z?: number } = {}
): WhiteboardObject | null {
  const rows = parseCsv(csv);
  if (rows.length === 0) return null;
  return rowsToTable(rows, boardId, worldOrigin, options);
}
