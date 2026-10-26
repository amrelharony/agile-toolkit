/**
 * The Decision Log's old blob, and its one-time move into
 * workspace.decisions.
 *
 * Before the merge the Decision Log page kept its own cloud-synced blob
 * (`agile-toolkit:decision-log`, a user_state row mirrored to
 * localStorage) and exchanged rows with workspace.decisions only through
 * Import / Push. The "decision" hand-off wrote both copies under one id, so
 * a record may sit in both, edited on either side. The move is a gap fill
 * by id (the feature-flag and ADKAR moves' pattern): a blob row the
 * workspace doesn't have is added; one it has fills only the fields the
 * workspace row lacks, and keeps the later lifecycle status of the two. A
 * moved-ids record (`agile-toolkit:decision-log:moved`) remembers what has
 * been handled, so a record deleted after the move stays deleted. The blob
 * is never deleted: it is the backup.
 *
 * Unlike the flags' move there is no "moved elsewhere" guess: hand-offs put
 * blob ids into the workspace on purpose, so a shared id says nothing about
 * an earlier move.
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
 * The workspace row with the blob's copy folded in: each field the row
 * lacks is filled from the blob, never one it holds, and the status is the
 * later of the two by STATUS_RANK (the blob's on a tie, the copy the team
 * edited on the old page). The row itself when nothing changes.
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
  if (blob.status !== row.status && STATUS_RANK[blob.status] >= STATUS_RANK[row.status]) {
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
  /** The moved-ids record after this move: the union of the old one and every blob id. */
  moved: string[];
  /** Whether `moved` grew. */
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
  const known = Array.isArray(moved) ? moved.filter((id) => typeof id === "string") : [];
  const rows = readDecisionLogRows(raw);
  if (rows.length === 0) return { toAdd: [], toFill: [], moved: known, changed: false };
  const marked = new Set(known);
  const have = new Map(existing.map((d) => [d.id, d]));
  const toAdd: Decision[] = [];
  const toFill: Decision[] = [];
  for (const blob of rows) {
    if (marked.has(blob.id)) continue;
    const row = have.get(blob.id);
    if (!row) {
      if (!isBlank(blob)) toAdd.push(blob);
      continue;
    }
    const next = filled(row, blob);
    if (next !== row) toFill.push(next);
  }
  const next = Array.from(new Set([...known, ...rows.map((d) => d.id)]));
  return { toAdd, toFill, moved: next, changed: next.length !== known.length };
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
