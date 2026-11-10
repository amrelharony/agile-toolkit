/**
 * Jira issues → canvas cards on a Kanban frame.
 *
 * The export is read by the one Jira reader (lib/jira/csv-export.ts, on the
 * shared CSV parser), the same one Sprint Planning's "Import from Jira
 * (CSV)" reads; this file only lays the issues out as cards.
 *
 * The output drops cards onto a Kanban frame with columns matching
 * Jira's standard statuses (To Do / In Progress / Done). Each card
 * carries `sourceRef = { tool: "jira", entityId: jira_key }`, so pasting
 * the same export again updates those cards instead of stacking copies.
 */

import type {
  WhiteboardObject,
  WhiteboardCard,
  WhiteboardKanbanFrame,
} from "@/lib/stores/workspace-types";
import {
  JIRA_SOURCE_TOOL,
  readJiraCsv,
  type JiraIssue,
  type JiraRowError,
} from "@/lib/jira/csv-export";
import { wbId } from "./clipboard";

export type { JiraIssue };

/**
 * Result of {@link parseJiraCsv}. Wraps the parsed issues with metadata
 * so callers can surface "your file was truncated" warnings without
 * silently losing rows.
 */
export interface JiraParseResult {
  issues: JiraIssue[];
  /** The rows the reader refused, with their line and why: the Canvas says so under the box. */
  skipped: JiraRowError[];
  /** Why nothing could be read at all (no issue key or summary column, over 5 MB), or null. */
  problem: string | null;
  /** True when the CSV held more rows than the reader takes (1,000,
   * lib/jira JIRA_CSV_MAX_ROWS); `issues` then comes from the first ones. */
  truncated: boolean;
  /** True when the input was over 5 MB (lib/jira JIRA_CSV_MAX_BYTES) and
   * was rejected; `issues` is empty. */
  oversize?: boolean;
}

/** Map a Jira status to our canonical column. Anything unrecognised
 * falls through to "todo". */
function normaliseStatus(jiraStatus: string): "todo" | "in_progress" | "done" {
  const s = (jiraStatus || "").toLowerCase();
  if (s.includes("done") || s.includes("closed") || s.includes("resolved")) return "done";
  if (s.includes("progress") || s.includes("review") || s.includes("doing")) return "in_progress";
  return "todo";
}

/**
 * The issues of a pasted Jira CSV export, for the Canvas. A row the reader
 * refuses (no key or summary, a key already on an earlier line, points that
 * aren't a number) is left out, and listed in `skipped` with why.
 */
export function parseJiraCsv(text: string): JiraParseResult {
  const read = readJiraCsv(text);
  const said = { skipped: read.errors, problem: read.problem };
  if (read.oversize) return { issues: [], ...said, truncated: false, oversize: true };
  return { issues: read.issues, ...said, truncated: read.overCap > 0 };
}

/** The most refused rows the Canvas names one by one; the rest are counted. */
const SKIPPED_NAMED = 3;

/**
 * What the Canvas says under the box about what a paste leaves out: why
 * nothing can be read, or how many rows can't be imported and why (the
 * first few by line), or null when every row reads.
 */
export function jiraSkippedText(
  result: Pick<JiraParseResult, "skipped" | "problem">
): string | null {
  if (result.problem) return result.problem;
  const { skipped } = result;
  if (skipped.length === 0) return null;
  const named = skipped.slice(0, SKIPPED_NAMED).map((e) => `Line ${e.line}: ${e.reason}.`);
  const more = skipped.length - named.length;
  return [
    `${skipped.length === 1 ? "1 row" : `${skipped.length} rows`} can't be imported.`,
    ...named,
    ...(more > 0 ? [`And ${more} more.`] : []),
  ].join(" ");
}

/**
 * Convert a list of Jira issues into a Kanban frame + Cards laid out
 * inside its columns. Re-uses the existing zCursor pattern so cards
 * land above any prior content (combine with the import-modal
 * z-baseline offset).
 */
export function issuesToCards(
  boardId: string,
  issues: readonly JiraIssue[],
  existing?: readonly WhiteboardObject[]
): WhiteboardObject[] {
  if (issues.length === 0) return [];
  const out: WhiteboardObject[] = [];
  const id = () => wbId();
  const now = new Date().toISOString();
  // R10-deferred: idempotent re-import — reuse card id when a card with
  // matching (tool="jira", entityId=j.key) already exists on this
  // board. Re-pasting the same CSV upserts instead of stacking
  // duplicate cards.
  // R11-fix: carry the existing card version so re-imports emit
  // `version: existing.version + 1`. Without the bump, peer LWW
  // rejects the re-imported state (incoming v=1 vs peer's v=N) so
  // re-imports replicate locally but never reach peers.
  const reuse = new Map<string, { id: string; version: number }>();
  if (existing) {
    for (const o of existing) {
      if (o.sourceRef?.tool === JIRA_SOURCE_TOOL && o.sourceRef.entityId) {
        reuse.set(o.sourceRef.entityId, { id: o.id, version: o.version });
      }
    }
  }

  const cols: ("todo" | "in_progress" | "done")[] = ["todo", "in_progress", "done"];
  const COL_W = 240;
  const COL_H = 700;
  const CARD_W = 220;
  const CARD_H = 110;
  const ORIGIN_X = 80;
  const ORIGIN_Y = 80;

  // Kanban frame: container with column metadata.
  const kanban: WhiteboardKanbanFrame = {
    id: id(),
    boardId,
    type: "kanban",
    x: ORIGIN_X - 16,
    y: ORIGIN_Y - 30,
    w: COL_W * cols.length + 32,
    h: COL_H + 60,
    z: 1,
    label: `Jira import (${issues.length})`,
    columns: cols,
    columnLabels: ["To Do", "In Progress", "Done"],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  out.push(kanban);

  // Bucket by column.
  const buckets: Record<string, JiraIssue[]> = { todo: [], in_progress: [], done: [] };
  for (const j of issues) buckets[normaliseStatus(j.status)].push(j);

  let z = 2;
  cols.forEach((col, colIdx) => {
    buckets[col].forEach((j, rowIdx) => {
      const reuseEntry = reuse.get(j.key);
      const card: WhiteboardCard = {
        id: reuseEntry?.id ?? id(),
        boardId,
        type: "card",
        x: ORIGIN_X + colIdx * COL_W,
        y: ORIGIN_Y + rowIdx * (CARD_H + 12),
        w: CARD_W,
        h: CARD_H,
        z: z++,
        title: `${j.key}: ${j.summary}`,
        description: j.description,
        assignee: j.assignee,
        due: j.dueDate,
        points: j.storyPoints,
        status: col,
        color: col === "done" ? "#34d399" : col === "in_progress" ? "#f59e0b" : "#00f0ff",
        tags: j.labels,
        version: reuseEntry ? reuseEntry.version + 1 : 1,
        createdAt: now,
        updatedAt: now,
        sourceRef: { tool: JIRA_SOURCE_TOOL, entityId: j.key },
      };
      out.push(card);
    });
  });

  return out;
}
