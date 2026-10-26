/**
 * The Decision Log's old blob, and its one-time move into
 * workspace.decisions.
 *
 * Before the merge the Decision Log page kept its own cloud-synced blob
 * (`agile-toolkit:decision-log`, a user_state row mirrored to
 * localStorage) and exchanged rows with workspace.decisions only through
 * Import / Push. Push copied every titled row into the workspace, and the
 * "decision" hand-off wrote both copies under one id, so a record may sit
 * in both, edited on either side. The move is a gap fill by id (the
 * feature-flag and ADKAR moves' pattern): a blob row the workspace doesn't
 * have is added; one it has fills only the fields the workspace row lacks,
 * and keeps the later lifecycle status of the two, unless the workspace
 * row was saved since the merge (POST_MERGE_FIELDS), which makes its status
 * the newer one. Text both hold differently is kept as the workspace has
 * it and reported (`conflicts`), so the page can offer the old page's
 * text. A moved-ids record (`agile-toolkit:decision-log:moved`) remembers
 * what has been handled, so a record deleted after the move stays deleted;
 * one deleted before it is marked moved by the delete
 * (isPendingDecisionLogRow). The blob is never deleted: it is the backup.
 *
 * Unlike the flags' move there is no "moved elsewhere" guess: Push and the
 * hand-offs put blob ids into the workspace on purpose, so a shared id
 * says nothing about an earlier move.
 *
 * Pure and server-safe: the page's move hook runs it in the browser, and
 * the agent actions read the pending rows through it on the server.
 */

import type { Decision } from "@/lib/stores/workspace-types";
import { STATUS_RANK, normalizeDecision } from "./model";

/** The Decision Log's old blob: never deleted, it is the backup once its rows move. */
export const DECISION_LOG_KEY = "agile-toolkit:decision-log";
/** The ids of the blob rows already moved into workspace.decisions. */
export const DECISION_LOG_MOVED_KEY = "agile-toolkit:decision-log:moved";

/** A row with nothing in it: the old page saved a blank one as soon as "New ADR" was pressed. */
function isBlank(d: Decision): boolean {
  return (
    !d.title &&
    !d.context &&
    !d.decision &&
    !d.consequences &&
    !(d.alternatives && d.alternatives.length > 0)
  );
}

/** Every usable record in the stored blob (anything that isn't a list reads as none). */
export function readDecisionLogRows(raw: unknown): Decision[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: Decision[] = [];
  for (const r of raw) {
    const d = normalizeDecision(r);
    if (!d || seen.has(d.id)) continue;
    seen.add(d.id);
    rows.push(d);
  }
  return rows;
}

/**
 * Whether `id` is a row of the blob the move hasn't handled yet, which the
 * Decision Log lists as it will read once moved (withPendingDecisionLog).
 * Deleting one has to mark it moved as well, or the move brings it back:
 * lib/decisions/store's removeDecisionRecord does that in the browser; the
 * agent actions, which read the moved-ids record but can't write it, can
 * refuse such a delete instead.
 */
export function isPendingDecisionLogRow(
  id: string,
  raw: unknown,
  moved: readonly string[]
): boolean {
  if (Array.isArray(moved) && moved.includes(id)) return false;
  return readDecisionLogRows(raw).some((d) => d.id === id);
}

/** Whether a stored field holds nothing: absent, blank text or an empty list. */
function lacks(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && !v.trim()) ||
    (Array.isArray(v) && v.length === 0)
  );
}

/**
 * Fields the old page and the old hand-off could never write: only code
 * from Phase 7 on sets them (a number, a template, a lifecycle date, a
 * replacement). A workspace row holding one was saved after the blob
 * stopped changing, by a writer that read the blob's copy through
 * (currentDecisions, the agent actions' list), so its status is the newer
 * one: a reopen, or a replacement named, before the move ran must not be
 * undone by the blob's older status. Content fields (options, roles, …)
 * don't count: a field edit through the generic CRUD says nothing about
 * the status.
 */
const POST_MERGE_FIELDS = [
  "number",
  "template",
  "decidedAt",
  "implementedAt",
  "reopenedAt",
  "supersededBy",
] as const;

/** Whether a workspace row was saved by post-merge code (see POST_MERGE_FIELDS). */
function savedSinceMerge(row: Decision): boolean {
  return POST_MERGE_FIELDS.some((key) => !lacks(row[key]));
}

/** The fields the old page let the team write, compared for `conflicts`. */
export const DECISION_LOG_TEXT_FIELDS = [
  "title",
  "context",
  "decision",
  "consequences",
  "alternatives",
] as const;
export type DecisionLogTextField = (typeof DECISION_LOG_TEXT_FIELDS)[number];

/**
 * A field both copies of a record hold with different text. The move keeps
 * the workspace's (it fills only what the workspace row lacks); the old
 * page's text stays in the blob, the backup.
 */
export interface DecisionLogConflict {
  id: string;
  field: DecisionLogTextField;
  /** The old Decision Log's text. */
  blob: string | string[];
  /** The workspace's text, which the move keeps. */
  workspace: string | string[];
}

/** A text field as compared: trimmed text, or a list's non-blank lines; null when it holds nothing. */
function textValue(v: unknown): string | string[] | null {
  if (typeof v === "string") return v.trim() || null;
  if (!Array.isArray(v)) return null;
  const lines = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  return lines.length > 0 ? lines : null;
}

/**
 * The text fields both copies hold differently. Only for a row not saved
 * since the merge: either copy may be the newer one there (Push copied a
 * row the team then kept editing on the old page; an agent edited the
 * workspace's), while a row saved since is the newer one by construction.
 */
function conflictsOf(row: Decision, blob: Decision): DecisionLogConflict[] {
  if (savedSinceMerge(row)) return [];
  const conflicts: DecisionLogConflict[] = [];
  for (const field of DECISION_LOG_TEXT_FIELDS) {
    const b = textValue(blob[field]);
    const w = textValue(row[field]);
    if (b === null || w === null || JSON.stringify(b) === JSON.stringify(w)) continue;
    conflicts.push({ id: row.id, field, blob: b, workspace: w });
  }
  return conflicts;
}

/**
 * The workspace row with the blob's copy folded in: each field the row
 * lacks is filled from the blob, never one it holds. The status is the
 * later of the two by STATUS_RANK (the blob's on a tie, the copy the team
 * edited on the old page), except that a row saved since the merge keeps
 * its own. The row itself when nothing changes.
 */
function filled(row: Decision, blob: Decision): Decision {
  const next: Decision = { ...row };
  const fields = next as unknown as Record<string, unknown>;
  let changed = false;
  for (const key of Object.keys(blob) as (keyof Decision)[]) {
    if (key === "id" || key === "status") continue;
    if (lacks(row[key]) && !lacks(blob[key])) {
      fields[key] = blob[key];
      changed = true;
    }
  }
  if (
    !savedSinceMerge(row) &&
    blob.status !== row.status &&
    STATUS_RANK[blob.status] >= STATUS_RANK[row.status]
  ) {
    next.status = blob.status;
    changed = true;
  }
  return changed ? next : row;
}

export interface DecisionLogMove {
  /** Blob rows to add: not in the workspace and never moved before (blank rows are left behind). */
  toAdd: Decision[];
  /** Workspace rows the blob's copy fills in (gaps only, and the later status). */
  toFill: Decision[];
  /**
   * Text the two copies of a record hold differently, kept as the
   * workspace has it: for the page to offer the old page's text. Rows
   * already moved, and rows saved since the merge, report none.
   */
  conflicts: DecisionLogConflict[];
  /** The moved-ids record after this move: the old one and every blob id, each once. */
  moved: string[];
  /** Whether `moved` gained an id. */
  changed: boolean;
}

/**
 * The one-time move of the Decision Log's blob into workspace.decisions.
 * `existing` is the workspace's records, `moved` the ids handled before.
 * A row in `moved` is left alone either way. Pure and idempotent: running
 * the plan, saving it and planning again adds and fills nothing, and so
 * does planning again when only the moved-ids write was lost.
 */
export function planDecisionLogMove(
  raw: unknown,
  existing: readonly Decision[],
  moved: readonly string[]
): DecisionLogMove {
  // Each id once: a repeat in the stored record must not hide a new id from `changed`.
  const known = Array.from(
    new Set(Array.isArray(moved) ? moved.filter((id) => typeof id === "string") : [])
  );
  const rows = readDecisionLogRows(raw);
  if (rows.length === 0) {
    return { toAdd: [], toFill: [], conflicts: [], moved: known, changed: false };
  }
  const marked = new Set(known);
  const have = new Map(existing.map((d) => [d.id, d]));
  const toAdd: Decision[] = [];
  const toFill: Decision[] = [];
  const conflicts: DecisionLogConflict[] = [];
  for (const blob of rows) {
    if (marked.has(blob.id)) continue;
    const row = have.get(blob.id);
    if (!row) {
      if (!isBlank(blob)) toAdd.push(blob);
      continue;
    }
    const next = filled(row, blob);
    if (next !== row) toFill.push(next);
    conflicts.push(...conflictsOf(row, blob));
  }
  const next = Array.from(new Set([...known, ...rows.map((d) => d.id)]));
  return { toAdd, toFill, conflicts, moved: next, changed: next.length !== known.length };
}

/**
 * The records as they will read once the move has run: `existing` with the
 * blob's pending rows filled in and added. For readers that can't wait for
 * the page's move (the hand-off's exists / isDone, the agent actions), so
 * a record the team edited only on the old page reads the way it will.
 */
export function withPendingDecisionLog(
  existing: readonly Decision[],
  raw: unknown,
  moved: readonly string[]
): Decision[] {
  const plan = planDecisionLogMove(raw, existing, moved);
  if (plan.toAdd.length === 0 && plan.toFill.length === 0) return [...existing];
  const fills = new Map(plan.toFill.map((d) => [d.id, d]));
  return [...existing.map((d) => fills.get(d.id) ?? d), ...plan.toAdd];
}
