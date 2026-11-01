/**
 * The Tech Debt page's old blob, and its one-time move into
 * workspace.techDebt.
 *
 * Before Phase 8 the Tech Debt page kept its own cloud-synced blob
 * (`agile-toolkit:tech-debt`, a user_state row mirrored to localStorage)
 * and exchanged rows with workspace.techDebt only through Import / Push:
 * Push copied every titled row into the workspace, and agents edited the
 * workspace's copy, so an item may sit in both, edited on either side. The
 * move is the Risk Register's (lib/risks/legacy-register) with debt
 * fields:
 *
 * - A blob row the workspace doesn't have is added; a blank one (the old
 *   page's instant "New Debt": no title, description or area) is left in
 *   the backup.
 * - A row saved since the upgrade (`updatedAt`; every Phase 8 writer saves
 *   the row with the blob's copy folded in, see withPendingTechDebt and
 *   listedTechDebt) keeps everything: nothing is filled, so a field
 *   cleared since stays clear and a reopen since stays open, and nothing
 *   is reported.
 * - Otherwise one both hold fills only the fields the workspace row lacks,
 *   never one it holds; the later status wins: resolved ranks after open,
 *   so a resolvedAt the workspace row lacks is filled from the blob and a
 *   workspace resolvedAt is kept; and each field both copies hold
 *   differently keeps the workspace's value and is reported (`conflicts`),
 *   for the page to offer the old page's value once.
 * - Workspace rows the old page never listed (not in its blob; its delete
 *   took the workspace copy too, so these are agent-made) are reported
 *   (`appeared`) for the page's one-time notice.
 * - The move saves every row it reports, as it is where nothing fills, and
 *   the save stamps it (lib/tech-debt/store saveTechDebt), so a later plan
 *   reports it no more, even when the moved-ids write was lost.
 * - A moved-ids record (`agile-toolkit:tech-debt:moved`) remembers what has
 *   been handled; a delete before the move marks the row moved
 *   (lib/tech-debt/store removeTechDebtRecord).
 *
 * A write on a pending row before the page's move ran (an agent's verb,
 * the workspace.tech_debt CRUD, an edit on the page) saves the row as
 * listed, stamped: a field the copies held differently keeps the
 * workspace's value and reports no conflict (decision U3), so the old
 * page's value is left in the backup only.
 *
 * The blob is never deleted: it is the backup. Pure and server-safe.
 */

import type { TechDebtItem } from "@/lib/stores/workspace-types";
import { toScale } from "@/lib/risks/model";
import { INTEREST_RATE_MAX, normalizeTechDebt } from "./model";

/** The Tech Debt page's old blob: never deleted, it is the backup once its rows move. */
export const TECH_DEBT_KEY = "agile-toolkit:tech-debt";
/** The ids of the blob rows already moved into workspace.techDebt. */
export const TECH_DEBT_MOVED_KEY = "agile-toolkit:tech-debt:moved";

/** A row with nothing in it: the old page saved a blank one as soon as "New Debt" was pressed. */
function isBlank(t: TechDebtItem): boolean {
  return !t.title && !t.description && !t.area;
}

/** Every usable item in the stored blob, each id once (anything that isn't a list reads as none). */
export function readTechDebtRows(raw: unknown): TechDebtItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: TechDebtItem[] = [];
  for (const x of raw) {
    const t = normalizeTechDebt(x);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    rows.push(t);
  }
  return rows;
}

/**
 * Whether `id` is a row of the blob the move hasn't handled yet, which the
 * page lists as it will read once moved (withPendingTechDebt). Deleting one
 * has to mark it moved as well, or the move brings it back: the browser
 * store does that; the agent actions refuse such a delete ('pending_move').
 */
export function isPendingTechDebtRow(id: string, raw: unknown, moved: readonly string[]): boolean {
  if (Array.isArray(moved) && moved.includes(id)) return false;
  return readTechDebtRows(raw).some((t) => t.id === id);
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

/** Whether a workspace row was saved since the move into the workspace (only Phase 8 writers stamp `updatedAt`). */
const savedSinceUpgrade = (row: TechDebtItem): boolean => !lacks(row.updatedAt);

/** The fields the old page let the team write, compared for `conflicts`. */
export const TECH_DEBT_CONFLICT_FIELDS = [
  "title",
  "description",
  "area",
  "impact",
  "effort",
  "interestRate",
] as const;
export type TechDebtConflictField = (typeof TECH_DEBT_CONFLICT_FIELDS)[number];

/** A field both copies of an item hold differently; the move keeps the workspace's. */
export interface TechDebtConflict {
  id: string;
  field: TechDebtConflictField;
  /** The old page's value (a rating on the 1–5 scale, a rate in 0–100). */
  blob: string | number;
  /** The workspace's value, which the move keeps. */
  workspace: string | number;
}

/** A field as compared: trimmed text, a rating on the scale or a finite rate; null when it holds nothing. */
function valueOf(row: TechDebtItem, field: TechDebtConflictField): string | number | null {
  if (field === "impact" || field === "effort") return toScale(row[field]);
  if (field === "interestRate") {
    const r = row.interestRate;
    return typeof r === "number" && Number.isFinite(r)
      ? Math.max(0, Math.min(INTEREST_RATE_MAX, r))
      : null;
  }
  const v = row[field];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The fields both copies hold differently, for a row not saved since the upgrade. */
function conflictsOf(row: TechDebtItem, blob: TechDebtItem): TechDebtConflict[] {
  if (savedSinceUpgrade(row)) return [];
  const conflicts: TechDebtConflict[] = [];
  for (const field of TECH_DEBT_CONFLICT_FIELDS) {
    const b = valueOf(blob, field);
    const w = valueOf(row, field);
    if (b === null || w === null || b === w) continue;
    conflicts.push({ id: row.id, field, blob: b, workspace: w });
  }
  return conflicts;
}

/** Fields the gap fill never copies: the id, the status (resolvedAt, handled below) and the save stamp. */
const SKIP_FILL = new Set<keyof TechDebtItem>(["id", "resolvedAt", "updatedAt"]);

/**
 * The workspace row with the blob's copy folded in: each field the row
 * lacks is filled from the blob, never one it holds, and a resolvedAt the
 * row lacks is filled (resolved is the later status). A row saved since
 * the upgrade keeps everything (its writer folded the blob's copy in
 * already: a field it lacks was cleared since). The row itself when
 * nothing changes.
 */
function filled(row: TechDebtItem, blob: TechDebtItem): TechDebtItem {
  if (savedSinceUpgrade(row)) return row;
  const next: TechDebtItem = { ...row };
  const fields = next as unknown as Record<string, unknown>;
  let changed = false;
  for (const key of Object.keys(blob) as (keyof TechDebtItem)[]) {
    if (SKIP_FILL.has(key)) continue;
    if (lacks(row[key]) && !lacks(blob[key])) {
      fields[key] = blob[key];
      changed = true;
    }
  }
  if (lacks(row.resolvedAt) && !lacks(blob.resolvedAt)) {
    next.resolvedAt = blob.resolvedAt;
    changed = true;
  }
  return changed ? next : row;
}

export interface TechDebtMove {
  /** Blob rows to add: not in the workspace and never moved before (blank rows are left behind). */
  toAdd: TechDebtItem[];
  /**
   * Workspace rows the move saves: the ones the blob's copy fills in (gaps
   * only, and a resolution), and, as they are, the ones it reports in
   * `conflicts` or `appeared` with nothing to fill. Saving stamps them
   * (saveTechDebt), so a later plan, after a lost moved-ids write too,
   * reports them no more. A row saved as it is keeps its object.
   */
  toFill: TechDebtItem[];
  /** Values the two copies hold differently, kept as the workspace has them (none for rows moved or saved since). */
  conflicts: TechDebtConflict[];
  /**
   * Ids of workspace rows the old page never listed (not in its blob) and
   * nobody has saved since the upgrade: items an agent made, or Pushed rows
   * the page lost since. For the page's one-time notice. Only when the old
   * page kept a blob (a list, an empty one included); a row made since the
   * upgrade (stamped) is a new one, not one that appeared.
   */
  appeared: string[];
  /** The moved-ids record after this move: the old one and every blob id, each once. */
  moved: string[];
  /** Whether `moved` gained an id. */
  changed: boolean;
}

/**
 * The one-time move of the Tech Debt blob into workspace.techDebt.
 * `existing` is the workspace's items, `moved` the ids handled before. Pure
 * and idempotent, as planRiskRegisterMove.
 */
export function planTechDebtMove(
  raw: unknown,
  existing: readonly TechDebtItem[],
  moved: readonly string[]
): TechDebtMove {
  const known = Array.from(
    new Set(Array.isArray(moved) ? moved.filter((id) => typeof id === "string") : [])
  );
  const rows = readTechDebtRows(raw);
  const marked = new Set(known);
  const have = new Map(existing.map((t) => [t.id, t]));
  const toAdd: TechDebtItem[] = [];
  const toFill: TechDebtItem[] = [];
  const conflicts: TechDebtConflict[] = [];
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
  const inBlob = new Set(rows.map((t) => t.id));
  const unlisted = Array.isArray(raw)
    ? existing.filter((t) => !inBlob.has(t.id) && !savedSinceUpgrade(t))
    : [];
  toFill.push(...unlisted);
  const appeared = unlisted.map((t) => t.id);
  const next = Array.from(new Set([...known, ...rows.map((t) => t.id)]));
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
 * The items as they will read once the move has run: `existing` with the
 * blob's pending rows filled in and added (a row the move only saves, to
 * stamp it, keeps its object).
 */
export function withPendingTechDebt(
  existing: readonly TechDebtItem[],
  raw: unknown,
  moved: readonly string[]
): TechDebtItem[] {
  const plan = planTechDebtMove(raw, existing, moved);
  if (plan.toAdd.length === 0 && plan.toFill.length === 0) return [...existing];
  const fills = new Map(plan.toFill.map((t) => [t.id, t]));
  return [...existing.map((t) => fills.get(t.id) ?? t), ...plan.toAdd];
}

/**
 * One stored workspace item as the page lists it: with its copy in the old
 * blob folded in while that copy waits for the page's move, else the row
 * itself. What the workspace.tech_debt CRUD's update merges its patch
 * into, as listedRisk.
 */
export function listedTechDebt(
  row: TechDebtItem,
  raw: unknown,
  moved: readonly string[]
): TechDebtItem {
  if (!isPendingTechDebtRow(row.id, raw, moved)) return row;
  const blob = readTechDebtRows(raw).find((t) => t.id === row.id);
  return blob ? filled(row, blob) : row;
}
