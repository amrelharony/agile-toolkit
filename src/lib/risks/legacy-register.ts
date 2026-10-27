/**
 * The Risk Register's old blob, and its one-time move into workspace.risks.
 *
 * Before Phase 8 the Risk Register page kept its own cloud-synced blob
 * (`agile-toolkit:risk-register`, a user_state row mirrored to
 * localStorage) and exchanged rows with workspace.risks only through
 * Import / Push. Push copied every titled row into the workspace, and the
 * "risk" hand-off wrote both copies under one id, so a risk may sit in
 * both, edited on either side (agents edit the workspace's). The move is
 * Phase 7's decision-log move (lib/decisions/legacy-log) with risk fields:
 *
 * - A blob row the workspace doesn't have is added (example rows too, so
 *   the page shows what it showed); a blank one (the old page's instant
 *   "New Risk": no title, mitigation or due date) is left in the backup.
 * - A row saved since the upgrade (`updatedAt`: only Phase 8 writers stamp
 *   it, and every one of them saves the row with the blob's copy folded in,
 *   see withPendingRisks and listedRisk) keeps everything: nothing is
 *   filled, so a field cleared since stays clear, its status stays, and
 *   nothing is reported.
 * - Otherwise one both hold fills only the fields the workspace row lacks,
 *   never one it holds; the status becomes the later of the two by
 *   RISK_STATUS_RANK; and each rating or text field both copies hold
 *   differently keeps the workspace's value and is reported (`conflicts`),
 *   so the page can offer the old page's value once.
 * - Workspace rows the old page never listed (not in its blob: an agent's,
 *   or one the old page deleted from its blob only, after a Push) are
 *   reported (`appeared`) for the page's one-time notice.
 * - The move saves every row it reports, as it is where nothing fills, and
 *   the save stamps it (lib/risks/store saveRisks): a reported row is then
 *   saved since the upgrade, so a later plan reports it no more, even when
 *   the moved-ids write was lost. That makes both notices one-time.
 * - A moved-ids record (`agile-toolkit:risk-register:moved`) remembers
 *   what has been handled, so a row deleted after the move stays deleted;
 *   one deleted before it is marked moved by the delete
 *   (lib/risks/store removeRiskRecord, through isPendingRiskRow).
 *
 * A write on a pending row before the page's move ran (an agent's verb,
 * the workspace.risk CRUD, an edit on the page) saves the row as listed,
 * stamped: the workspace's value of a field the copies held differently is
 * kept, and that row reports no conflict (decision U3: a row saved since
 * the upgrade keeps everything), so the old page's value is left in the
 * backup only.
 *
 * The blob is never deleted: it is the backup. Pure and server-safe: the
 * page's move hook runs it in the browser, and the agent actions and the
 * workspace.risk CRUD read the pending rows through it on the server.
 */

import type { Risk } from "@/lib/stores/workspace-types";
import { RISK_STATUS_RANK, normalizeRisk, toScale } from "./model";

/** The Risk Register's old blob: never deleted, it is the backup once its rows move. */
export const RISK_REGISTER_KEY = "agile-toolkit:risk-register";
/** The ids of the blob rows already moved into workspace.risks. */
export const RISK_REGISTER_MOVED_KEY = "agile-toolkit:risk-register:moved";

/** A row with nothing in it: the old page saved a blank one as soon as "New Risk" was pressed. */
function isBlank(r: Risk): boolean {
  return !r.title && !r.mitigation && !r.mitigationDueAt;
}

/** Every usable risk in the stored blob, each id once (anything that isn't a list reads as none). */
export function readRiskRegisterRows(raw: unknown): Risk[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: Risk[] = [];
  for (const x of raw) {
    const r = normalizeRisk(x);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push(r);
  }
  return rows;
}

/**
 * Whether `id` is a row of the blob the move hasn't handled yet, which the
 * register lists as it will read once moved (withPendingRisks). Deleting
 * one has to mark it moved as well, or the move brings it back:
 * lib/risks/store's removeRiskRecord does that in the browser; the agent
 * actions, which read the moved-ids record but can't write it, refuse such
 * a delete instead ('pending_move').
 */
export function isPendingRiskRow(id: string, raw: unknown, moved: readonly string[]): boolean {
  if (Array.isArray(moved) && moved.includes(id)) return false;
  return readRiskRegisterRows(raw).some((r) => r.id === id);
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
 * Whether a workspace row was saved since the register moved into the
 * workspace: every Phase 8 writer (the page, the hand-off, the tool verbs,
 * the workspace.risk CRUD) stamps `updatedAt`, and the old page and the old
 * hand-off never did. Such a row is newer than the blob, which stopped
 * changing at the upgrade.
 */
const savedSinceUpgrade = (row: Risk): boolean => !lacks(row.updatedAt);

/** The fields the old page let the team write, compared for `conflicts`. */
export const RISK_CONFLICT_FIELDS = [
  "title",
  "mitigation",
  "mitigationDueAt",
  "probability",
  "impact",
] as const;
export type RiskConflictField = (typeof RISK_CONFLICT_FIELDS)[number];

/**
 * A field both copies of a risk hold with different values. The move keeps
 * the workspace's (it fills only what the workspace row lacks); the old
 * page's stays in the blob, the backup, for the page to offer once.
 */
export interface RiskRegisterConflict {
  id: string;
  field: RiskConflictField;
  /** The old register's value (a rating on the 1–5 scale). */
  blob: string | number;
  /** The workspace's value, which the move keeps. */
  workspace: string | number;
}

/** A field as compared: trimmed text, or a rating on the scale; null when it holds nothing. */
function valueOf(row: Risk, field: RiskConflictField): string | number | null {
  if (field === "probability" || field === "impact") return toScale(row[field]);
  const v = row[field];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The fields both copies hold differently. Only for a row not saved since
 * the upgrade: either copy may be the newer one there (Push copied a row
 * the team then kept editing on the old page; an agent edited the
 * workspace's), while a row saved since is the newer one by construction.
 */
function conflictsOf(row: Risk, blob: Risk): RiskRegisterConflict[] {
  if (savedSinceUpgrade(row)) return [];
  const conflicts: RiskRegisterConflict[] = [];
  for (const field of RISK_CONFLICT_FIELDS) {
    const b = valueOf(blob, field);
    const w = valueOf(row, field);
    if (b === null || w === null || b === w) continue;
    conflicts.push({ id: row.id, field, blob: b, workspace: w });
  }
  return conflicts;
}

/** Fields the gap fill handles on its own (the status, the residual pair) or never copies. */
const SKIP_FILL = new Set<keyof Risk>([
  "id",
  "status",
  "residualProbability",
  "residualImpact",
  "updatedAt",
]);

/**
 * The workspace row with the blob's copy folded in: each field the row
 * lacks is filled from the blob, never one it holds (resolvedAt included;
 * the residual rating only as a pair, and only when the row has neither),
 * and the status is the later of the two by RISK_STATUS_RANK. A row saved
 * since the upgrade keeps everything: its writer saved it with the blob's
 * copy folded in already, so a field it lacks was cleared since and must
 * not come back. The row itself when nothing changes.
 */
function filled(row: Risk, blob: Risk): Risk {
  if (savedSinceUpgrade(row)) return row;
  const next: Risk = { ...row };
  const fields = next as unknown as Record<string, unknown>;
  let changed = false;
  for (const key of Object.keys(blob) as (keyof Risk)[]) {
    // The save stamp is the workspace's own: a blob row never earns one.
    if (SKIP_FILL.has(key)) continue;
    if (lacks(row[key]) && !lacks(blob[key])) {
      fields[key] = blob[key];
      changed = true;
    }
  }
  if (
    lacks(row.residualProbability) &&
    lacks(row.residualImpact) &&
    blob.residualProbability !== undefined &&
    blob.residualImpact !== undefined
  ) {
    next.residualProbability = blob.residualProbability;
    next.residualImpact = blob.residualImpact;
    changed = true;
  }
  if (
    blob.status !== row.status &&
    RISK_STATUS_RANK[blob.status] >= (RISK_STATUS_RANK[row.status] ?? -1)
  ) {
    next.status = blob.status;
    changed = true;
  }
  return changed ? next : row;
}

export interface RiskRegisterMove {
  /** Blob rows to add: not in the workspace and never moved before (blank rows are left behind). */
  toAdd: Risk[];
  /**
   * Workspace rows the move saves: the ones the blob's copy fills in (gaps
   * only, and the later status), and, as they are, the ones it reports in
   * `conflicts` or `appeared` with nothing to fill. Saving stamps them
   * (saveRisks), which settles them: a later plan, after a lost moved-ids
   * write too, reports them no more. A row saved as it is keeps its
   * object, so a reader comparing rows sees no change in it.
   */
  toFill: Risk[];
  /**
   * Values the two copies of a risk hold differently, kept as the
   * workspace has them: for the page to offer the old page's value once.
   * Rows already moved, and rows saved since the upgrade, report none.
   */
  conflicts: RiskRegisterConflict[];
  /**
   * Ids of workspace rows the old page never listed (not in its blob) and
   * nobody has saved since the upgrade: risks an agent made, and rows the
   * old page deleted from its blob only (its delete never touched the
   * workspace's copy of a Pushed row). The register lists them from now
   * on, with a one-time notice saying how many appeared. Only when the old
   * page kept a blob (a list, an empty one included: every row deleted
   * there); with none, nothing was listed to compare with. A row made
   * since the upgrade (stamped) is a new one, not one that appeared.
   */
  appeared: string[];
  /** The moved-ids record after this move: the old one and every blob id, each once. */
  moved: string[];
  /** Whether `moved` gained an id. */
  changed: boolean;
}

/**
 * The one-time move of the Risk Register's blob into workspace.risks.
 * `existing` is the workspace's risks, `moved` the ids handled before. A
 * row in `moved` is left alone either way. Pure and idempotent: running
 * the plan, saving it (stamped) and planning again adds, fills and reports
 * nothing, and so does planning again when only the moved-ids write was
 * lost.
 */
export function planRiskRegisterMove(
  raw: unknown,
  existing: readonly Risk[],
  moved: readonly string[]
): RiskRegisterMove {
  // Each id once: a repeat in the stored record must not hide a new id from `changed`.
  const known = Array.from(
    new Set(Array.isArray(moved) ? moved.filter((id) => typeof id === "string") : [])
  );
  const rows = readRiskRegisterRows(raw);
  const marked = new Set(known);
  const have = new Map(existing.map((r) => [r.id, r]));
  const toAdd: Risk[] = [];
  const toFill: Risk[] = [];
  const conflicts: RiskRegisterConflict[] = [];
  for (const blob of rows) {
    if (marked.has(blob.id)) continue;
    const row = have.get(blob.id);
    if (!row) {
      if (!isBlank(blob)) toAdd.push(blob);
      continue;
    }
    const next = filled(row, blob);
    const differ = conflictsOf(row, blob);
    conflicts.push(...differ);
    // Saved as it is when it only reports a conflict, so the stamp settles it.
    if (next !== row || differ.length > 0) toFill.push(next);
  }
  // Rows only the workspace holds, while nobody has saved them since the
  // upgrade: saved as they are, so the notice is shown once.
  const inBlob = new Set(rows.map((r) => r.id));
  const unlisted = Array.isArray(raw)
    ? existing.filter((r) => !inBlob.has(r.id) && !savedSinceUpgrade(r))
    : [];
  toFill.push(...unlisted);
  const appeared = unlisted.map((r) => r.id);
  const next = Array.from(new Set([...known, ...rows.map((r) => r.id)]));
  return {
    toAdd,
    toFill,
    conflicts,
    appeared,
    moved: next,
    changed: next.length !== known.length,
  };
}

/**
 * The risks as they will read once the move has run: `existing` with the
 * blob's pending rows filled in and added. For readers that can't wait for
 * the page's move (the hand-off's exists, the agent actions), so a risk
 * the team edited only on the old page reads the way it will; a row the
 * move only saves, to stamp it, keeps its object.
 */
export function withPendingRisks(
  existing: readonly Risk[],
  raw: unknown,
  moved: readonly string[]
): Risk[] {
  const plan = planRiskRegisterMove(raw, existing, moved);
  if (plan.toAdd.length === 0 && plan.toFill.length === 0) return [...existing];
  const fills = new Map(plan.toFill.map((r) => [r.id, r]));
  return [...existing.map((r) => fills.get(r.id) ?? r), ...plan.toAdd];
}

/**
 * One stored workspace risk as the register lists it: with its copy in the
 * old blob folded in while that copy waits for the page's move (as
 * withPendingRisks reads it), else the row itself. What a write that
 * starts from the stored row merges into (the workspace.risk CRUD's
 * update), so it saves the row the page and the tool verbs would: its
 * stamp must not make a row that lacks the blob's later status or values
 * read as the newer copy.
 */
export function listedRisk(row: Risk, raw: unknown, moved: readonly string[]): Risk {
  if (!isPendingRiskRow(row.id, raw, moved)) return row;
  const blob = readRiskRegisterRows(raw).find((r) => r.id === row.id);
  return blob ? filled(row, blob) : row;
}
