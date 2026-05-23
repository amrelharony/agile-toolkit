/**
 * CSV → WhiteboardTable converter for the import-modal flow.
 *
 * Standalone parser (no PapaParse dependency just for this) that
 * handles the common shape: optional header row, quoted cells with
 * embedded commas / quotes, CRLF / LF line endings.
 *
 * Empty trailing rows / fully-empty rows are dropped. Ragged rows
 * (shorter than the longest row) are padded with "" so the table
 * column count stays consistent.
 */

import { wbId } from "./clipboard";
import type { WhiteboardObject, WhiteboardTable } from "@/lib/stores/workspace-types";

/**
 * Parse a CSV string into a 2D array. Handles:
 *   - Quoted cells: `"hello, world"` → one cell containing comma
 *   - Escaped quotes inside quoted cells: `"He said ""hi"""` → `He said "hi"`
 *   - CRLF / LF / CR line endings
 *   - Trailing newline (ignored)
 *
 * Does NOT handle:
 *   - BOM (stripped silently — the textarea paste path won't include one)
 *   - Alternate delimiters (tab / semicolon). Could be added with a
 *     simple detection pass if users complain.
 */
export function parseCsv(input: string): string[][] {
  if (typeof input !== "string" || input.length === 0) return [];
  const s = input.replace(/^﻿/, ""); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === "\"") {
        // Escaped quote `""` → literal `"`
        if (s[i + 1] === "\"") {
          cell += "\"";
          i += 2;
          continue;
        }
        // End of quoted segment
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === "\"") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      // Push the in-flight cell + row, then skip a CRLF pair.
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      if (ch === "\r" && s[i + 1] === "\n") i += 2;
      else i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  // Push any trailing cell/row.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop fully-empty rows (paste with trailing blank line).
  const filtered = rows.filter((r) => r.some((c) => c.length > 0));
  if (filtered.length === 0) return [];
  // Pad ragged rows to the widest column count so the table has
  // consistent column widths.
  const maxCols = Math.max(...filtered.map((r) => r.length));
  return filtered.map((r) => {
    if (r.length === maxCols) return r;
    const pad = new Array(maxCols - r.length).fill("");
    return [...r, ...pad];
  });
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
  options: { headerRow?: boolean; z?: number } = {},
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
  options: { headerRow?: boolean; z?: number } = {},
): WhiteboardObject | null {
  const rows = parseCsv(csv);
  if (rows.length === 0) return null;
  return rowsToTable(rows, boardId, worldOrigin, options);
}
