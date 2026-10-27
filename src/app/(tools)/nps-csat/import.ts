/**
 * Survey responses from a CSV file or a spreadsheet paste, checked row by
 * row before anything is saved. Survey tools export CSV; typing a quarter's
 * answers one at a time was the only way in before.
 *
 * - One parser for every import (lib/utils/csv): quoted commas and line
 *   breaks, doubled quotes, CRLF, a byte-order mark, and the delimiter
 *   sniffed from the first line (a spreadsheet paste is tab-separated).
 * - The first row names the columns; `date` and `score` are required, and
 *   kind, respondent, verbatim and tags are optional (headers match loosely:
 *   "Comment", "Feedback" and "Verbatim" are all the verbatim).
 * - With no kind column the user picks NPS or CSAT for the whole file:
 *   there is no default.
 * - A row is refused with its line number and why: more cells than the
 *   header names (an unquoted comma in a verbatim would otherwise cut it
 *   and shift the rest into the next column), a date that isn't YYYY-MM-DD
 *   (a timestamp, with "T" or a space, reads as its day) or is in the
 *   future, a score that isn't whole or is off the kind's scale (lib/nps
 *   isValidScore, as the form and the agent judge), too many or too long
 *   tags (tagsProblem), a respondent or verbatim longer than the form
 *   saves. Nothing is cut silently, and no row is saved that its own edit
 *   form would then refuse.
 * - An exact copy of a stored response (survey, day, score, respondent and
 *   verbatim) is skipped and listed, so importing a file twice adds
 *   nothing; two stored copies skip two rows, not every copy in the file.
 * - At most IMPORT_CAP rows are read per import.
 *
 * Pure; the page's import panel renders what it returns.
 */

import type { NpsResponse } from "@/lib/stores/workspace-types";
import {
  SCORE_RANGE,
  isValidScore,
  normalizeTags,
  tagsProblem,
  type SurveyKind,
} from "@/lib/nps/score";
import { headerKey, parseCsvRows, sniffDelimiter, type CsvDelimiter } from "@/lib/utils/csv";
import { isIsoDate, parseWallClock } from "@/lib/sprints/calendar";
import { RESPONDENT_MAX, VERBATIM_MAX } from "./form";

/** Rows read per import; split a bigger file. */
export const IMPORT_CAP = 1000;

export type ImportColumn = "date" | "kind" | "score" | "respondent" | "verbatim" | "tags";

/** Header cells (as lib/utils/csv headerKey reads them) per column. */
const ALIASES: Record<ImportColumn, readonly string[]> = {
  date: [
    "date",
    "day",
    "submitted",
    "submittedat",
    "submittedon",
    "responsedate",
    "createdat",
    "answeredat",
    "timestamp",
  ],
  kind: ["kind", "type", "survey", "surveytype", "metric"],
  score: ["score", "rating", "value", "answer", "npsscore", "csatscore"],
  respondent: ["respondent", "email", "name", "customer", "user", "respondentemail"],
  verbatim: ["verbatim", "comment", "comments", "feedback", "text", "reason", "why", "response"],
  tags: ["tags", "tag", "themes", "theme", "topics", "topic"],
};

/** The response a row holds, before it gets an id. */
export type ImportedResponse = Omit<NpsResponse, "id">;

export interface ImportRow {
  /** The 1-based line the row starts on. */
  line: number;
  response: ImportedResponse;
}

export interface SkippedRow {
  line: number;
  reason: string;
}

export interface ImportPreview {
  /** Rows that will be saved. */
  ready: ImportRow[];
  /** Exact copies of stored responses: left out. */
  duplicates: ImportRow[];
  /** Rows that can't be saved, and why. */
  skipped: SkippedRow[];
  /** Data rows read (after the header, up to the cap). */
  rows: number;
  /** Data rows past IMPORT_CAP, not read. */
  overCap: number;
  /** True when the file has no kind column, so the user picks one for every row. */
  needsKind: boolean;
  /** Why nothing can be read at all (no header, a required column missing), or null. */
  problem: string | null;
}

const EMPTY: ImportPreview = {
  ready: [],
  duplicates: [],
  skipped: [],
  rows: 0,
  overCap: 0,
  needsKind: false,
  problem: null,
};

/** "nps" / "csat" from a kind cell: "NPS", "Net Promoter", "CSAT", "Satisfaction". */
export function readKind(cell: string): SurveyKind | null {
  const k = headerKey(cell);
  if (k === "nps" || k.startsWith("netpromoter") || k.startsWith("promoter")) return "nps";
  if (k === "csat" || k.startsWith("customersatisfaction") || k.startsWith("satisfaction"))
    return "csat";
  return null;
}

/**
 * A row's identity for spotting a copy of a stored response: survey, day,
 * score, respondent and verbatim, trimmed. Tags aren't part of it: a row
 * re-imported after tagging is still the same answer.
 */
export function responseKey(
  r: Pick<NpsResponse, "kind" | "date" | "score" | "respondent" | "verbatim">
): string {
  return [
    r.kind,
    String(r.date ?? "").slice(0, 10),
    r.score,
    (r.respondent ?? "").trim(),
    (r.verbatim ?? "").trim(),
  ].join("\u0000");
}

const DELIMITER_NAME: Record<CsvDelimiter, string> = {
  ",": "commas",
  "\t": "tabs",
  ";": "semicolons",
};

/** Cells up to the last one with something in it: trailing blanks ("a,b,,") don't count. */
function filledLength(cells: readonly string[]): number {
  let n = cells.length;
  while (n > 0 && !cells[n - 1].trim()) n--;
  return n;
}

/** The column index of each known header, or undefined. */
function columnsOf(header: readonly string[]): Partial<Record<ImportColumn, number>> {
  const found: Partial<Record<ImportColumn, number>> = {};
  header.forEach((cell, i) => {
    const key = headerKey(cell);
    for (const col of Object.keys(ALIASES) as ImportColumn[]) {
      if (found[col] === undefined && ALIASES[col].includes(key)) {
        found[col] = i;
        return;
      }
    }
  });
  return found;
}

/**
 * What importing `text` would do. `kind` is the survey the user picked for
 * a file with no kind column (null until picked: such a file then has
 * nothing ready); `existing` are the stored responses to skip copies of;
 * `today` bounds the dates.
 */
export function previewImport(
  text: string,
  {
    kind,
    today,
    existing,
  }: { kind: SurveyKind | null; today: string; existing: readonly NpsResponse[] }
): ImportPreview {
  if (!text.trim()) return EMPTY;
  const delimiter = sniffDelimiter(text);
  const rows = parseCsvRows(text, delimiter);
  if (rows.length === 0) return EMPTY;
  const cols = columnsOf(rows[0].cells);
  const width = filledLength(rows[0].cells);
  if (cols.date === undefined || cols.score === undefined) {
    const missing = [cols.date === undefined ? "date" : "", cols.score === undefined ? "score" : ""]
      .filter(Boolean)
      .join(" and ");
    return {
      ...EMPTY,
      problem: `The first row must name the columns. No ${missing} column found: name them “date” and “score” (kind, respondent, verbatim and tags are optional).`,
    };
  }
  const data = rows.slice(1);
  const read = data.slice(0, IMPORT_CAP);
  const needsKind = cols.kind === undefined;
  const base: ImportPreview = {
    ...EMPTY,
    rows: read.length,
    overCap: Math.max(0, data.length - IMPORT_CAP),
    needsKind,
  };
  if (needsKind && !kind) return base;

  // A stored response can stand for one row of the file: two stored copies skip two rows.
  const stored = new Map<string, number>();
  for (const r of existing) {
    const key = responseKey(r);
    stored.set(key, (stored.get(key) ?? 0) + 1);
  }

  const ready: ImportRow[] = [];
  const duplicates: ImportRow[] = [];
  const skipped: SkippedRow[] = [];
  const at = (cells: string[], col: ImportColumn) => {
    const i = cols[col];
    return i === undefined ? "" : (cells[i] ?? "").trim();
  };
  for (const { line, cells } of read) {
    const skip = (reason: string) => skipped.push({ line, reason });
    // First: in a row wider than its header every cell after the stray
    // delimiter sits in the wrong column, so nothing else about it is true.
    const filled = filledLength(cells);
    if (filled > width) {
      skip(
        `it has ${filled} cells but the header names ${width}: put text that contains ${DELIMITER_NAME[delimiter]} in quotes`
      );
      continue;
    }
    const rowKind = needsKind ? kind : readKind(at(cells, "kind"));
    if (!rowKind) {
      skip(`the kind “${at(cells, "kind")}” isn't NPS or CSAT`);
      continue;
    }
    // A timestamp ("2026-10-03T14:20:00Z", "2026-10-03 14:20") reads as its
    // day, as the workspace stores it (lib/sprints parseWallClock).
    const rawDate = at(cells, "date");
    const date = parseWallClock(rawDate)?.day ?? rawDate;
    if (!(date.length === 10 && isIsoDate(date))) {
      skip(rawDate ? `the date “${rawDate}” isn't YYYY-MM-DD` : "no date");
      continue;
    }
    if (date > today) {
      skip(`${date} is in the future`);
      continue;
    }
    const rawScore = at(cells, "score");
    const score = rawScore === "" ? Number.NaN : Number(rawScore);
    if (!isValidScore(rowKind, score)) {
      const { min, max } = SCORE_RANGE[rowKind];
      skip(
        rawScore
          ? `the score “${rawScore}” isn't a whole number from ${min} to ${max} (${rowKind.toUpperCase()})`
          : "no score"
      );
      continue;
    }
    const rawTags = at(cells, "tags");
    const tagIssue = tagsProblem(rawTags);
    if (tagIssue) {
      skip(tagIssue);
      continue;
    }
    // The form's limits, so an imported row can be edited and saved as it is.
    const respondent = at(cells, "respondent");
    if (respondent.length > RESPONDENT_MAX) {
      skip(`the respondent is longer than ${RESPONDENT_MAX} characters`);
      continue;
    }
    const verbatim = at(cells, "verbatim");
    if (verbatim.length > VERBATIM_MAX) {
      skip(`the verbatim is longer than ${VERBATIM_MAX} characters`);
      continue;
    }
    const tags = normalizeTags(rawTags);
    const response: ImportedResponse = {
      kind: rowKind,
      date,
      score,
      ...(respondent ? { respondent } : {}),
      ...(verbatim ? { verbatim } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    };
    const key = responseKey(response);
    const copies = stored.get(key) ?? 0;
    if (copies > 0) {
      stored.set(key, copies - 1);
      duplicates.push({ line, response });
    } else ready.push({ line, response });
  }
  return { ...base, ready, duplicates, skipped };
}
