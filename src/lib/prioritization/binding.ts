/**
 * The live two-way binding between method rows and the shared backlog,
 * as pure functions (the browser writes live in ./backlog-links, the agent
 * actions apply the same functions on the server).
 *
 * - The BacklogItem OWNS the inputs it holds: MoSCoW's bucket, WSJF's four
 *   parts, RICE's five inputs and Value/Effort's value and effort. A linked
 *   row of those methods READS THROUGH to the item (`effectiveFields`), so
 *   a hub or agent edit shows in the tool at once with no write to rows.
 * - A save in a method tool WRITES THROUGH: the row and the item's owned
 *   fields in one step (`ownedPatch` + `applyItemPatch`).
 * - Nothing fans writes out to rows, so there is no loop to guard.
 * - A save names what it clears: an input present as undefined is a clear
 *   (`clearedKeys`), written through to the item like any other value; an
 *   input the save leaves out keeps what the row shows.
 * - When the item goes, its rows FREEZE a copy of the values they showed
 *   (`frozenRow`) before they are unlinked (`rowsUnlinkedFrom`), however it
 *   is deleted: the hub, the store, the agent's CRUD on either transport.
 * - A link made before Phase 7 whose item still holds a method's old
 *   defaults reads the row's own value there (methods legacyRowValues),
 *   and a save of the item starts from `withLegacyLinks(item, rows)`, so
 *   the item's first save through the new code keeps that value. A legacy
 *   row that disagrees with its item is marked just before that save
 *   (methods markLegacyDifferences), so its tool still asks which to keep.
 *
 * Cross-device sync is whole-entity last-writer-wins (lib/sync/lww): two
 * devices editing different fields of one item at once keep one side. That
 * is the single-user model's accepted limit; local writes patch only owned
 * keys onto the freshest copy, never a stale one.
 */

import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { readBacklogItem, withoutOldDefaults } from "./defaults";
import {
  methodFor,
  method,
  readThrough,
  scoreCache,
  withoutLegacyMark,
  type EvalContext,
  type MethodId,
  type RowFields,
  type Values,
} from "./methods";

/** The backlog item a row is linked to, when that item still exists. */
export function linkedItem(
  row: Pick<PrioritizationItem, "backlogItemId">,
  items: readonly BacklogItem[]
): BacklogItem | undefined {
  return row.backlogItemId ? items.find((b) => b.id === row.backlogItemId) : undefined;
}

/**
 * The fields a row shows and scores from: an embedded method's owned
 * inputs from its linked item, the rest of the row as stored.
 */
export function effectiveFields(row: PrioritizationItem, item?: BacklogItem): RowFields {
  return readThrough(row, item);
}

/**
 * The input keys a save clears on purpose: present in `values` as
 * undefined (a form's blanked input). A key left out is not one of them.
 */
export function clearedKeys(values: Values): string[] {
  return Object.keys(values).filter((k) => values[k] === undefined);
}

/**
 * The backlog fields a method's inputs set: only the set ones, as entered
 * (an exact custom impact is kept). An unset input is not a clear: a
 * Value/Effort row without a value never wipes WSJF's business value.
 * Only the inputs named in `cleared` (see clearedKeys) clear their backlog
 * field, present in the patch as undefined: the user blanked the value the
 * row read through, so the item, which owns it, drops it too.
 */
export function ownedPatch(
  id: MethodId,
  v: Values,
  cleared: readonly string[] = []
): Partial<BacklogItem> {
  const m = method(id);
  if (!m.embedded || !m.toBacklog || !m.owns) return {};
  const patch = m.toBacklog(v);
  const out: Partial<BacklogItem> = {};
  for (const key of m.owns) {
    if (patch[key] !== undefined) (out as Record<string, unknown>)[key] = patch[key];
  }
  for (const input of m.inputs) {
    const key = input.backlogKey;
    if (!key || !cleared.includes(input.key) || !m.owns.includes(key)) continue;
    if (out[key] === undefined) (out as Record<string, unknown>)[key] = undefined;
  }
  return out;
}

/** True when `a` and `b` hold the same value (numbers compared exactly). */
const same = (a: unknown, b: unknown) => a === b;

/** WSJF's parts other than the value: while any is set, WSJF still uses the value. */
const WSJF_OTHER_PARTS = ["timeCriticality", "riskReduction", "jobSize"] as const;

/**
 * The one value field (`businessValue`) is WSJF's business value and the
 * Value/Effort value at once, so a save that clears one of those two
 * methods whole leaves the value to the other while it still uses it:
 * - clearing WSJF (none of its other parts left) keeps a value the matrix
 *   places (the item keeps a matrix effort);
 * - clearing Value/Effort (its effort cleared with it) keeps WSJF's
 *   business value while one of WSJF's other parts is set.
 * A clear of the value alone, with the rest of its method kept, still
 * clears it, and so does a whole clear nobody else uses the value for.
 * `read` is the item as the engine reads it (readBacklogItem). Every save
 * of an item's inputs applies it (itemPatchChanges): the hub, the method
 * tools and the agent actions alike.
 */
export function withSharedValueKept(
  read: BacklogItem,
  patch: Partial<BacklogItem>
): Partial<BacklogItem> {
  if (!("businessValue" in patch) || patch.businessValue !== undefined) return patch;
  const after = (k: keyof BacklogItem) => (k in patch ? patch[k] : read[k]);
  const effortCleared = "matrixEffort" in patch && patch.matrixEffort === undefined;
  const wsjfUses = WSJF_OTHER_PARTS.some((k) => after(k) !== undefined);
  const matrixUses = after("matrixEffort") !== undefined;
  if (effortCleared ? !wsjfUses : wsjfUses || !matrixUses) return patch;
  const out = { ...patch };
  delete out.businessValue;
  return out;
}

/**
 * The keys of `patch` that change the item as the engine reads it: a value
 * equal to what the item already reads as is no change, so a backlog
 * import that saves the item's own values writes nothing. A value the old
 * defaults hid (a stored "should" read as Not sorted) is a change; a
 * business value the legacy 1–10 value already reads as is not. A key set
 * to undefined (a clear) is a change only while the item reads a value
 * there. A clear of the shared value the other method still uses is no
 * change (withSharedValueKept), unless `keepSharedValue: false` (an
 * explicit request to clear it, as set_position's clearBacklog).
 */
export function itemPatchChanges(
  item: BacklogItem,
  patch: Partial<BacklogItem>,
  opts: { keepSharedValue?: boolean } = {}
): Partial<BacklogItem> {
  const read = readBacklogItem(item);
  const given = opts.keepSharedValue === false ? patch : withSharedValueKept(read, patch);
  const out: Partial<BacklogItem> = {};
  for (const key of Object.keys(given) as (keyof BacklogItem)[]) {
    const next = given[key];
    let cur: unknown = read[key];
    if (next === undefined) {
      if (cur !== undefined) (out as Record<string, unknown>)[key] = undefined;
      continue;
    }
    // A row or item without a period counts per quarter.
    if (key === "reachPeriod" && cur === undefined) cur = "quarter";
    if (!same(next, cur)) (out as Record<string, unknown>)[key] = next;
  }
  return out;
}

/**
 * The item saved by the new code: the old-default fingerprints rewritten
 * to unset (so they can't come back as values), `patch` applied (a key set
 * to undefined is removed: the hub's Clear) and `updatedAt` stamped, which
 * marks every value as chosen from now on (lib/prioritization/defaults).
 *
 * A patch that writes or clears `businessValue` also drops the legacy 1–10
 * `value`: it is read only while businessValue is missing, so a cleared
 * business value would otherwise come back as the old value's Fibonacci
 * step, and a written one leaves it dead.
 */
export function applyItemPatch(
  item: BacklogItem,
  patch: Partial<BacklogItem>,
  now: string = new Date().toISOString()
): BacklogItem {
  const next: BacklogItem = { ...withoutOldDefaults(item) };
  for (const key of Object.keys(patch) as (keyof BacklogItem)[]) {
    const v = patch[key];
    if (v === undefined) delete next[key];
    else (next as unknown as Record<string, unknown>)[key] = v;
  }
  if ("businessValue" in patch) delete next.value;
  next.updatedAt = now;
  return next;
}

/**
 * A row made from a method's inputs: `values` written over the previous
 * row's fields (its other keys kept, but for a legacy mark: a save of the
 * row answers the question it kept, methods markLegacyDifferences), the
 * score cache from the engine and the link kept unless `backlogItemId`
 * says otherwise.
 */
export function methodRow(input: {
  id: string;
  framework: MethodId;
  title: string;
  values: Values;
  prev?: PrioritizationItem;
  backlogItemId?: string | null;
  now?: string;
  ctx?: EvalContext;
}): PrioritizationItem {
  const m = method(input.framework);
  const fields = m.write(withoutLegacyMark(input.prev?.fields), input.values);
  const cache = scoreCache(m.evaluate(m.read(fields), input.ctx), input.prev?.status);
  const row: PrioritizationItem = {
    ...input.prev,
    id: input.id,
    framework: input.framework,
    title: input.title.trim().slice(0, 200),
    fields,
    status: cache.status,
    updatedAt: input.now ?? new Date().toISOString(),
  };
  if (cache.score === undefined) delete row.score;
  else row.score = cache.score;
  if (input.backlogItemId === null) delete row.backlogItemId;
  else if (input.backlogItemId !== undefined) row.backlogItemId = input.backlogItemId;
  return row;
}

/**
 * The row as it should stay once its item is deleted: the values it read
 * through copied into its own fields, the score cache recomputed and
 * `updatedAt` stamped. The link itself is cleared by rowsUnlinkedFrom.
 * Rows of methods the item holds nothing for come back unchanged.
 */
export function frozenRow(
  row: PrioritizationItem,
  item: BacklogItem,
  now: string = new Date().toISOString()
): PrioritizationItem {
  const m = methodFor(row.framework);
  if (!m || !m.embedded || row.backlogItemId !== item.id) return row;
  // Unlinked, it owns its values: there is no item left to disagree with.
  const fields = withoutLegacyMark(effectiveFields(row, item));
  const cache = scoreCache(m.evaluate(m.read(fields)), row.status);
  const next: PrioritizationItem = { ...row, fields, status: cache.status, updatedAt: now };
  if (cache.score === undefined) delete next.score;
  else next.score = cache.score;
  return next;
}

/**
 * The rows linked to backlog item `id`, as they stay once it is deleted:
 * each frozen with the values it showed (frozenRow, when the item is still
 * at hand), unlinked and stamped. Only those rows come back. The store's
 * removeBacklogItem and the agent's server delete both apply it, so a
 * delete from anywhere keeps a WSJF row's scores.
 */
export function rowsUnlinkedFrom(
  rows: readonly PrioritizationItem[],
  id: string,
  item?: BacklogItem,
  now: string = new Date().toISOString()
): PrioritizationItem[] {
  return rows
    .filter((r) => r.backlogItemId === id)
    .map((r) => {
      const next: PrioritizationItem = { ...(item ? frozenRow(r, item, now) : r), updatedAt: now };
      delete next.backlogItemId;
      return next;
    });
}
