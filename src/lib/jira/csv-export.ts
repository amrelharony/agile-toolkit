/**
 * A Jira Cloud CSV export, read into issues. The one Jira reader: Sprint
 * Planning's "Import from Jira (CSV)" makes backlog stories from it, and the
 * Canvas's "Jira → Kanban" makes cards (lib/whiteboard/jira-import.ts).
 *
 * Built against the CSV export format Atlassian documents for Jira Cloud
 * (an issue search exported as CSV, all fields or the current fields), not
 * against a live site: none was available when this was written. The
 * fixtures in test/jira/csv-export.test.ts are written from that documented
 * format. What it means here:
 *
 * - The first row names the columns. Headers match case-insensitively, by
 *   their letters and digits (lib/utils/csv `headerKey`), in the documented
 *   variants: "Issue key" or "Key"; "Summary"; "Assignee"; "Description";
 *   "Status"; "Priority"; "Labels"; "Due date"; and for points "Story
 *   Points", "Story point estimate", "Custom field (Story Points)" or
 *   "Custom field (Story point estimate)". Company-managed and team-managed
 *   projects name the points field apart and one export can hold both, so a
 *   row's first filled points column counts.
 * - A field with several values repeats its column: "Labels","Labels" holds
 *   one label in each. They are merged; a cell holding several labels
 *   separated by spaces (Jira labels have none inside) is split.
 * - A cell is quoted when it holds the delimiter, a quote or a line break,
 *   as a description often does. The shared reader (lib/utils/csv) takes a
 *   comma or a semicolon (a file a spreadsheet saved again in a European
 *   locale) and a byte-order mark.
 *
 * A row is refused with its line and why, never cut silently: more cells
 * than the header names, no issue key, no summary, a key already on an
 * earlier line, or story points that aren't a number, 0 or more. At most
 * JIRA_CSV_MAX_ROWS rows are read and a text over JIRA_CSV_MAX_BYTES isn't
 * read at all. Files from other trackers may work when their headers match;
 * that is untested.
 *
 * Pure; server-safe.
 */

import { headerKey, parseCsvRows, sniffDelimiter, type CsvDelimiter } from "@/lib/utils/csv";

/** Rows read from one export; split a bigger one. */
export const JIRA_CSV_MAX_ROWS = 1000;
/** The largest export read (5 MB as UTF-8): a 1,000-row export is far below it. */
export const JIRA_CSV_MAX_BYTES = 5 * 1024 * 1024;

/** `HandoffRef.tool` on what an import makes from a Jira issue (a story, a Canvas card). */
export const JIRA_SOURCE_TOOL = "jira";

export interface JiraIssue {
  key: string;
  summary: string;
  /** As written in the export ("" when the file has no status column). */
  status: string;
  assignee?: string;
  priority?: string;
  storyPoints?: number;
  description?: string;
  labels?: string[];
  dueDate?: string;
}

/** An issue and the 1-based line of the file its row starts on. */
export interface JiraRow extends JiraIssue {
  line: number;
}

/** The columns the reader knows, in the order a preview lists them. */
export const JIRA_COLUMNS = [
  "key",
  "summary",
  "points",
  "assignee",
  "description",
  "status",
  "priority",
  "labels",
  "dueDate",
] as const;
export type JiraColumn = (typeof JIRA_COLUMNS)[number];

/** Header cells, as `headerKey` reads them, per column. */
const ALIASES: Record<JiraColumn, readonly string[]> = {
  key: ["issuekey", "key"],
  summary: ["summary"],
  points: [
    "storypoints",
    "storypointestimate",
    "customfieldstorypoints",
    "customfieldstorypointestimate",
  ],
  assignee: ["assignee"],
  description: ["description"],
  status: ["status"],
  priority: ["priority"],
  labels: ["labels"],
  dueDate: ["duedate"],
};

export interface JiraColumnFound {
  column: JiraColumn;
  /** The header as the file writes it (its first copy). */
  header: string;
  /** How many columns of the file it is (Jira repeats "Labels"). */
  count: number;
}

export interface JiraColumnIgnored {
  header: string;
  count: number;
}

export interface JiraRowError {
  line: number;
  reason: string;
}

export interface JiraCsvRead {
  /** The rows that read as issues, in file order. */
  issues: JiraRow[];
  /** The rows that don't, and why. */
  errors: JiraRowError[];
  /** The known columns the file has, in JIRA_COLUMNS order. */
  found: JiraColumnFound[];
  /** Every other named column, in file order (a repeated one once, with its count). */
  ignored: JiraColumnIgnored[];
  /** Data rows read (after the header, up to the cap). */
  rows: number;
  /** Data rows past JIRA_CSV_MAX_ROWS, not read. */
  overCap: number;
  delimiter: CsvDelimiter;
  /** The text is over JIRA_CSV_MAX_BYTES, so none of it was read. */
  oversize: boolean;
  /** Why nothing can be read at all, or null. */
  problem: string | null;
}

const EMPTY: JiraCsvRead = {
  issues: [],
  errors: [],
  found: [],
  ignored: [],
  rows: 0,
  overCap: 0,
  delimiter: ",",
  oversize: false,
  problem: null,
};

const DELIMITER_NAME: Record<CsvDelimiter, string> = {
  ",": "commas",
  "\t": "tabs",
  ";": "semicolons",
};

/** The size of `text` as UTF-8, counted without encoding it. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      // A surrogate pair is one character of four bytes.
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** An issue key as matched: one-spaced and upper case, so "pay-12" is "PAY-12". */
export function jiraKeyMatch(key: string): string {
  return key.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Cells up to the last one with something in it: trailing blanks ("a,b,,") don't count. */
function filledLength(cells: readonly string[]): number {
  let n = cells.length;
  while (n > 0 && !cells[n - 1].trim()) n--;
  return n;
}

/** Story points as written: blank is none, a number 0 or more (a decimal comma too). */
function readPoints(raw: string): number | undefined | null {
  const text = raw.trim();
  if (!text) return undefined;
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return null;
  return Number(text.replace(",", "."));
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * What the export in `text` holds: its issues, the rows that can't be read
 * and why, and which columns were found and which ignored.
 */
export function readJiraCsv(text: string): JiraCsvRead {
  if (typeof text !== "string" || !text.trim()) return EMPTY;
  if (utf8Bytes(text) > JIRA_CSV_MAX_BYTES) {
    return {
      ...EMPTY,
      oversize: true,
      problem:
        "That is more than 5 MB. Export fewer issues at a time, such as one project or one sprint.",
    };
  }
  const delimiter = sniffDelimiter(text);
  const parsed = parseCsvRows(text, delimiter);
  if (parsed.length === 0) return EMPTY;

  const header = parsed[0].cells;
  const columns = new Map<JiraColumn, number[]>();
  const ignored = new Map<string, JiraColumnIgnored>();
  header.forEach((cell, i) => {
    const key = headerKey(cell);
    const column = JIRA_COLUMNS.find((c) => ALIASES[c].includes(key));
    if (column) {
      columns.set(column, [...(columns.get(column) ?? []), i]);
      return;
    }
    const name = oneLine(cell);
    if (!name) return;
    const seen = ignored.get(name);
    if (seen) seen.count += 1;
    else ignored.set(name, { header: name, count: 1 });
  });
  const found: JiraColumnFound[] = JIRA_COLUMNS.filter((c) => columns.has(c)).map((column) => {
    const at = columns.get(column) ?? [];
    return { column, header: oneLine(header[at[0]]), count: at.length };
  });
  const base: JiraCsvRead = { ...EMPTY, delimiter, found, ignored: Array.from(ignored.values()) };

  const missing = [
    columns.has("key") ? "" : "issue key",
    columns.has("summary") ? "" : "summary",
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      ...base,
      problem: `No ${missing.join(" or ")} column found. The first row must name the columns, as a Jira Cloud CSV export does: “Issue key” (or “Key”) and “Summary” are needed.`,
    };
  }

  const width = filledLength(header);
  const data = parsed.slice(1);
  const read = data.slice(0, JIRA_CSV_MAX_ROWS);
  const first = (cells: readonly string[], column: JiraColumn) => {
    const i = columns.get(column)?.[0];
    return i === undefined ? "" : (cells[i] ?? "");
  };
  const all = (cells: readonly string[], column: JiraColumn) =>
    (columns.get(column) ?? []).map((i) => cells[i] ?? "");

  const issues: JiraRow[] = [];
  const errors: JiraRowError[] = [];
  const lineOfKey = new Map<string, number>();
  for (const { line, cells } of read) {
    const refuse = (reason: string) => errors.push({ line, reason });
    // First: in a row wider than its header every cell after the stray
    // delimiter sits in the wrong column, so nothing else about it is true.
    const filled = filledLength(cells);
    if (filled > width) {
      refuse(
        `it has ${filled} cells but the header names ${width}: put text that contains ${DELIMITER_NAME[delimiter]} in quotes`
      );
      continue;
    }
    const key = oneLine(first(cells, "key"));
    if (!key) {
      refuse("no issue key");
      continue;
    }
    const summary = oneLine(first(cells, "summary"));
    if (!summary) {
      refuse(`${key} has no summary`);
      continue;
    }
    const earlier = lineOfKey.get(jiraKeyMatch(key));
    if (earlier !== undefined) {
      refuse(`${key} is already on line ${earlier}`);
      continue;
    }
    const pointsCells = all(cells, "points").filter((c) => c.trim());
    const points = pointsCells.length > 0 ? readPoints(pointsCells[0]) : undefined;
    if (points === null) {
      refuse(`the story points “${pointsCells[0].trim()}” aren't a number, 0 or more`);
      continue;
    }
    lineOfKey.set(jiraKeyMatch(key), line);
    const labels = all(cells, "labels")
      .flatMap((c) => c.split(/\s+/))
      .filter((label, i, list) => label && list.indexOf(label) === i);
    const assignee = oneLine(first(cells, "assignee"));
    const priority = oneLine(first(cells, "priority"));
    const description = first(cells, "description").trim();
    const dueDate = oneLine(first(cells, "dueDate"));
    issues.push({
      line,
      key,
      summary,
      status: oneLine(first(cells, "status")),
      ...(assignee ? { assignee } : {}),
      ...(priority ? { priority } : {}),
      ...(points !== undefined ? { storyPoints: points } : {}),
      ...(description ? { description } : {}),
      ...(labels.length > 0 ? { labels } : {}),
      ...(dueDate ? { dueDate } : {}),
    });
  }
  return {
    ...base,
    issues,
    errors,
    rows: read.length,
    overCap: Math.max(0, data.length - JIRA_CSV_MAX_ROWS),
  };
}
