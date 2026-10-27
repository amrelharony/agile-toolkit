/**
 * CSV text to rows, for every import that takes a pasted or uploaded table:
 * Canvas's table import, NPS / CSAT responses, Code Review's pull requests.
 * One parser (no PapaParse dependency for this), so a quoted comma or a
 * line break inside quotes reads the same in each.
 *
 * Handles quoted cells with embedded delimiters, line breaks and doubled
 * quotes (`"He said ""hi"""` is `He said "hi"`), CRLF / LF / CR line
 * endings, a leading byte-order mark, and blank lines (dropped). Cells are
 * kept as written, untrimmed; ragged rows keep their own length (`padRows`
 * evens them out for a table). A spreadsheet paste is tab-separated:
 * `sniffDelimiter` tells which. Pure; server-safe.
 */

/** One parsed row and the 1-based line of the input it starts on, for "Row 3: …" errors. */
export interface CsvRow {
  line: number;
  cells: string[];
}

/** The delimiters an import accepts: comma, tab (a spreadsheet paste) and semicolon. */
export type CsvDelimiter = "," | "\t" | ";";

const DELIMITERS: readonly CsvDelimiter[] = [",", "\t", ";"];

/**
 * Rows with the line each starts on. A row whose every cell is blank (an
 * empty line, a trailing newline, ",,") is dropped; its line still counts,
 * so later rows keep their line numbers.
 */
export function parseCsvRows(input: string, delimiter: CsvDelimiter = ","): CsvRow[] {
  if (typeof input !== "string" || input.length === 0) return [];
  const s = input.replace(/^﻿/, "");
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim().length > 0)) rows.push({ line: rowLine, cells: row });
    row = [];
    cell = "";
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote is a literal one; a single one ends the quoted part.
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === "\n" || (ch === "\r" && s[i + 1] !== "\n")) line += 1;
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRow();
      i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1;
      line += 1;
      rowLine = line;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell.length > 0 || row.length > 0) endRow();
  return rows;
}

/** The rows' cells only: `parseCsvRows` without the line numbers. */
export function parseCsv(input: string, delimiter: CsvDelimiter = ","): string[][] {
  return parseCsvRows(input, delimiter).map((r) => r.cells);
}

/** Rows padded with "" to the widest one, so a table's columns line up. */
export function padRows(rows: readonly (readonly string[])[]): string[][] {
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) =>
    r.length === width ? [...r] : [...r, ...new Array<string>(width - r.length).fill("")]
  );
}

/**
 * The delimiter of the first non-blank line: the one of comma, tab and
 * semicolon that occurs most outside quotes; a comma when none does (a
 * one-column file).
 */
export function sniffDelimiter(input: string): CsvDelimiter {
  const s = typeof input === "string" ? input.replace(/^﻿/, "") : "";
  const first = s.split(/\r\n|\n|\r/).find((l) => l.trim().length > 0) ?? "";
  const counts = new Map<CsvDelimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (const ch of first) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && counts.has(ch as CsvDelimiter)) {
      counts.set(ch as CsvDelimiter, (counts.get(ch as CsvDelimiter) ?? 0) + 1);
    }
  }
  let best: CsvDelimiter = ",";
  for (const d of DELIMITERS) if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d;
  return best;
}

/**
 * A header cell as a key to match columns by: lower-case letters and digits
 * only, so "Opened at", "opened_at" and "openedAt" all read "openedat".
 */
export function headerKey(cell: string): string {
  return cell
    .replace(/^﻿/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
