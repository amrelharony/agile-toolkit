/**
 * Jira issue import → canvas cards on a Kanban frame.
 *
 * Two paths:
 *   1. Paste a Jira CSV export — `parseJiraCsv(text)` returns a list of
 *      issues which we then convert to Cards via {@link issuesToCards}.
 *   2. Live API import via OAuth/PAT — caller provides the issue
 *      array (we don't ship the Jira client; that's app-level).
 *
 * The output drops cards onto a Kanban frame with columns matching
 * Jira's standard statuses (To Do / In Progress / Done). Each card
 * carries `sourceRef = { tool: "jira", entityId: jira_key }` so a
 * future "sync" can push back updates.
 */

import type { WhiteboardObject, WhiteboardCard, WhiteboardKanbanFrame } from "@/lib/stores/workspace-types";
import { wbId } from "./clipboard";

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  priority?: string;
  storyPoints?: number;
  description?: string;
  labels?: string[];
  dueDate?: string;
}

/**
 * Result of {@link parseJiraCsv}. Wraps the parsed issues with metadata
 * so callers can surface "your file was truncated" warnings without
 * silently losing rows.
 */
export interface JiraParseResult {
  issues: JiraIssue[];
  /** True when the CSV held more than {@link MAX_JIRA_ROWS} usable
   * rows; `issues` is then capped at the limit. */
  truncated: boolean;
  /** True when the input exceeded {@link MAX_JIRA_BYTES} and was rejected;
   * `issues` is empty. */
  oversize?: boolean;
}

/** Hard byte-size cap on Jira CSV input — anything larger is rejected
 * outright to avoid pegging the parser on adversarial input. */
const MAX_JIRA_BYTES = 5_000_000;
/** Hard cap on the number of returned issues. Beyond this we truncate
 * and signal via {@link JiraParseResult.truncated}. */
const MAX_JIRA_ROWS = 1000;

/** Map a Jira status to our canonical column. Anything unrecognised
 * falls through to "todo" with a console warning. */
function normaliseStatus(jiraStatus: string): "todo" | "in_progress" | "done" {
  const s = (jiraStatus || "").toLowerCase();
  if (s.includes("done") || s.includes("closed") || s.includes("resolved")) return "done";
  if (s.includes("progress") || s.includes("review") || s.includes("doing")) return "in_progress";
  return "todo";
}

/**
 * Minimal Jira CSV parser. Jira's "Issues navigator → Export CSV"
 * spits a header row with columns like "Issue key", "Summary",
 * "Status", "Assignee", "Story Points", "Priority", "Description".
 * Quoted fields with embedded commas / quotes are common; we
 * parse them out manually rather than pulling in a CSV library.
 *
 * Two hard limits keep this safe against adversarial input:
 *   - byte-size cap ({@link MAX_JIRA_BYTES}) — rejected outright
 *   - row cap ({@link MAX_JIRA_ROWS}) — returned issues truncated,
 *     with `truncated: true` signalled on the result
 *
 * Field buffering uses array-push + join (not `cell += c`) to keep
 * tokenisation O(n) instead of O(n^2) on long cells.
 */
export function parseJiraCsv(text: string): JiraParseResult {
  // Hard size cap — bigger than this and we don't even tokenise.
  if (text.length > MAX_JIRA_BYTES) {
    return { issues: [], truncated: false, oversize: true };
  }
  // R5: strip UTF-8 BOM (U+FEFF) that Excel-on-Windows prepends to
  // exported CSVs. Without this, the first header reads `"﻿issue
  // key"` instead of `"issue key"` → `indexOf("issue key")` misses
  // and the import silently returns zero issues.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let cur: string[] = [];
  // Array-buffer the field bytes; `cell += c` is O(n^2) under V8.
  let cellBuf: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cellBuf.push('"'); i++; }
      else if (c === '"') { inQuotes = false; }
      else { cellBuf.push(c); }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { cur.push(cellBuf.join("")); cellBuf = []; }
      else if (c === "\n" || c === "\r") {
        if (cellBuf.length > 0 || cur.length > 0) {
          cur.push(cellBuf.join(""));
          rows.push(cur);
          cur = []; cellBuf = [];
        }
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else { cellBuf.push(c); }
    }
  }
  if (cellBuf.length > 0 || cur.length > 0) { cur.push(cellBuf.join("")); rows.push(cur); }
  if (rows.length < 2) return { issues: [], truncated: false };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const indexOf = (name: string) => header.findIndex((h) => h === name || h.startsWith(name + " "));
  const iKey = indexOf("issue key") >= 0 ? indexOf("issue key") : indexOf("key");
  const iSummary = indexOf("summary");
  const iStatus = indexOf("status");
  const iAssignee = indexOf("assignee");
  const iPriority = indexOf("priority");
  const iPoints = indexOf("story points") >= 0 ? indexOf("story points") : indexOf("custom field (story points)");
  const iDesc = indexOf("description");
  const iLabels = indexOf("labels");
  const iDue = indexOf("due date");
  const issues: JiraIssue[] = [];
  let truncated = false;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (iKey < 0 || !row[iKey]) continue;
    if (issues.length >= MAX_JIRA_ROWS) { truncated = true; break; }
    const points = iPoints >= 0 && row[iPoints] ? Number(row[iPoints]) : undefined;
    issues.push({
      key: row[iKey].trim(),
      summary: iSummary >= 0 ? (row[iSummary] ?? "").trim() : "",
      status: iStatus >= 0 ? (row[iStatus] ?? "").trim() : "",
      assignee: iAssignee >= 0 ? row[iAssignee]?.trim() || undefined : undefined,
      priority: iPriority >= 0 ? row[iPriority]?.trim() || undefined : undefined,
      storyPoints: typeof points === "number" && Number.isFinite(points) ? points : undefined,
      description: iDesc >= 0 ? row[iDesc]?.trim() || undefined : undefined,
      labels: iLabels >= 0 && row[iLabels] ? row[iLabels].split(/\s+/).filter(Boolean) : undefined,
      dueDate: iDue >= 0 ? row[iDue]?.trim() || undefined : undefined,
    });
  }
  return { issues, truncated };
}

/**
 * Convert a list of Jira issues into a Kanban frame + Cards laid out
 * inside its columns. Re-uses the existing zCursor pattern so cards
 * land above any prior content (combine with the import-modal
 * z-baseline offset).
 */
export function issuesToCards(boardId: string, issues: readonly JiraIssue[]): WhiteboardObject[] {
  if (issues.length === 0) return [];
  const out: WhiteboardObject[] = [];
  const id = () => wbId();
  const now = new Date().toISOString();

  const cols: ("todo" | "in_progress" | "done")[] = ["todo", "in_progress", "done"];
  const COL_W = 240;
  const COL_H = 700;
  const CARD_W = 220;
  const CARD_H = 110;
  const ORIGIN_X = 80;
  const ORIGIN_Y = 80;

  // Kanban frame: container with column metadata.
  const kanban: WhiteboardKanbanFrame = {
    id: id(), boardId, type: "kanban",
    x: ORIGIN_X - 16, y: ORIGIN_Y - 30,
    w: COL_W * cols.length + 32, h: COL_H + 60,
    z: 1,
    label: `Jira import (${issues.length})`,
    columns: cols,
    columnLabels: ["To Do", "In Progress", "Done"],
    version: 1, createdAt: now, updatedAt: now,
  };
  out.push(kanban);

  // Bucket by column.
  const buckets: Record<string, JiraIssue[]> = { todo: [], in_progress: [], done: [] };
  for (const j of issues) buckets[normaliseStatus(j.status)].push(j);

  let z = 2;
  cols.forEach((col, colIdx) => {
    buckets[col].forEach((j, rowIdx) => {
      const card: WhiteboardCard = {
        id: id(),
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
        version: 1,
        createdAt: now,
        updatedAt: now,
        sourceRef: { tool: "jira", entityId: j.key },
      };
      out.push(card);
    });
  });

  return out;
}
