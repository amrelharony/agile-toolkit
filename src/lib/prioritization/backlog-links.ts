/**
 * Writes that link method rows to the shared backlog (the browser side of
 * ./binding's live two-way binding).
 *
 * Every write reads the freshest workspace state right before it and goes
 * through the store's upsert/remove actions. A backlog item is always
 * saved through `applyItemPatch` (old-default fingerprints cleared,
 * `updatedAt` stamped), starting from what its links made before Phase 7
 * still hold (`itemSaveBase`), and the first such save marks the legacy
 * rows that disagree with it (`keepLegacyDifferences`), so their tools
 * still ask which value to keep. Cross-tool writes (creating a backlog item,
 * writing a row's inputs to it) run inside `undoable`, and Undo puts back
 * only what nobody has changed since: a hub edit made inside the Undo
 * window stays.
 *
 * Client-only (undoable shows a toast): the agent actions apply ./binding
 * on the server instead.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import {
  applyItemPatch,
  clearedKeys,
  effectiveFields,
  itemPatchChanges,
  linkedItem,
  methodRow,
  ownedPatch,
} from "./binding";
import { withoutOldDefaults } from "./defaults";
import { createBacklogItem } from "./frameworks";
import { markLegacyDifferences, methodFor, withLegacyLinks, type Values } from "./methods";

const ws = () => useWorkspaceStore.getState();

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim() || "Untitled item";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const findBacklogItem = (id: string) => (ws().backlogItems ?? []).find((b) => b.id === id);
const findRow = (id: string) => (ws().prioritizations ?? []).find((p) => p.id === id);

/** The backlog item a row is linked to, when that item still exists. */
export function linkedBacklogItem(
  row: Pick<PrioritizationItem, "backlogItemId">,
  items: readonly BacklogItem[]
): BacklogItem | undefined {
  return linkedItem(row, items);
}

/**
 * The item a save starts from: as its legacy links say it reads (rows
 * linked before Phase 7 that still hold the only real value, methods
 * withLegacyLinks), so the first save through the new code writes those
 * values to the item instead of hiding them for good with its stamp.
 * Exported for a caller that works out what a save changes before making
 * it (the hub's saveScores logs exactly what saveBacklogItem writes).
 */
export const itemSaveBase = (item: BacklogItem): BacklogItem =>
  withLegacyLinks(item, ws().prioritizations ?? []);

/**
 * What an Undo puts a saved item back to once someone has saved it since:
 * the item as the engine read it before the save (old defaults unset, its
 * legacy links' values in). Taken before the save changes any row.
 */
const undoBaseline = (item: BacklogItem) => withoutOldDefaults(itemSaveBase(item));

/**
 * The backlog fields a row's stored inputs set, limited to the ones that
 * change the item; `cleared` names inputs the user blanked (clearedKeys),
 * which clear the item's field too.
 */
function inputChanges(
  item: BacklogItem,
  row: PrioritizationItem,
  cleared: readonly string[] = []
): Partial<BacklogItem> {
  const m = methodFor(row.framework);
  if (!m || !m.embedded) return {};
  return itemPatchChanges(itemSaveBase(item), ownedPatch(m.id, m.read(row.fields), cleared));
}

const hasChanges = (changes: Partial<BacklogItem>) => Object.keys(changes).length > 0;

/**
 * With a save of `stored` as `after`: the legacy marks of the rows linked
 * to it (methods markLegacyDifferences). Its first save marks each row that
 * disagrees with it from before Phase 7, so its tool still asks which value
 * to keep once the stamp is on; a later save settles a question the item
 * now answers. `except` is a row the same save writes itself.
 */
function keepLegacyDifferences(stored: BacklogItem, after: BacklogItem, except?: string): void {
  for (const row of markLegacyDifferences(stored, ws().prioritizations ?? [], { except, after })) {
    ws().upsertPrioritization(row);
  }
}

/**
 * Write `changes` onto the freshest copy of the backlog item; returns what
 * was stored. `except` is the row the save comes from (keepLegacyDifferences).
 */
function applyInputs(
  item: BacklogItem,
  changes: Partial<BacklogItem>,
  except?: string
): BacklogItem | undefined {
  if (!hasChanges(changes)) return undefined;
  const cur = findBacklogItem(item.id) ?? item;
  // The base first: the marks below restamp rows, which must not change it.
  const next = applyItemPatch(itemSaveBase(cur), changes);
  keepLegacyDifferences(cur, next, except);
  ws().upsertBacklogItem(next);
  return next;
}

/**
 * Put back the fields `written` overwrote, as they were on `before`, but
 * only those whose current value is still what was written: an edit made
 * since (in the hub, by an agent) is never clobbered.
 *
 * The save also unset the old-default fingerprints and stamped `updatedAt`
 * (applyItemPatch), and those two go back only together. While the stamp
 * is still ours, nobody saved the item since and it returns to exactly
 * what it was, fingerprints and all (they read as Not scored again, and
 * its legacy links read as before). Once someone has saved it, the stamp
 * stays, so the item is read as chosen: the baseline is then `baseline`,
 * `before` as the engine read it (undoBaseline: the fingerprints unset,
 * the legacy links' values in), never an old default brought back as a
 * score.
 */
function restoreInputs(
  before: BacklogItem,
  written: BacklogItem | undefined,
  baseline: BacklogItem
): void {
  if (!written) return;
  const cur = findBacklogItem(before.id);
  if (!cur) return;
  const base = cur.updatedAt === written.updatedAt ? before : baseline;
  const back: Record<string, unknown> = { ...cur };
  let changed = false;
  const keys = Array.from(new Set([...Object.keys(base), ...Object.keys(written)]));
  for (const key of keys) {
    if (key === "id") continue;
    const k = key as keyof BacklogItem;
    if (written[k] === base[k] || cur[k] !== written[k]) continue;
    if (base[k] === undefined) delete back[key];
    else back[key] = base[k];
    changed = true;
  }
  if (changed) ws().upsertBacklogItem(back as unknown as BacklogItem);
}

function unlinkRow(rowId: string, backlogItemId: string): void {
  const cur = findRow(rowId);
  if (!cur || cur.backlogItemId !== backlogItemId) return;
  const next: PrioritizationItem = { ...cur };
  delete next.backlogItemId;
  ws().upsertPrioritization(next);
}

/**
 * Save a backlog item through the new code (the hub's cell edits, renames):
 * `patch` over the freshest copy, a key set to undefined cleared, the
 * old-default fingerprints unset and `updatedAt` stamped (its legacy rows
 * that disagree with it marked first: keepLegacyDifferences). A patch that
 * changes nothing the engine reads writes nothing. Returns the stored item.
 */
export function saveBacklogItem(id: string, patch: Partial<BacklogItem>): BacklogItem | undefined {
  const cur = findBacklogItem(id);
  if (!cur) return undefined;
  const base = itemSaveBase(cur);
  const changes = itemPatchChanges(base, patch);
  if (!hasChanges(changes)) return cur;
  const next = applyItemPatch(base, changes);
  keepLegacyDifferences(cur, next);
  ws().upsertBacklogItem(next);
  return next;
}

/**
 * Link a row that is about to be added to the backlog item the user
 * imported it from. Returns the row to upsert.
 *
 * For methods the backlog holds inputs for, the row's inputs are written to
 * the backlog item now, so the item (which owns them) and the row agree;
 * from then on the row reads through to the item and later saves write
 * back (saveMethodRow). That write is undoable. A missing item leaves the
 * row unlinked.
 *
 * `values`, when given, are the inputs as the form saved them: one present
 * as undefined is a value the user blanked from the import's prefill, and
 * it clears the item's field too (the row reads through, so a value left
 * on the item would come straight back).
 */
export function linkNewRow(
  row: PrioritizationItem,
  backlogItemId: string | null | undefined,
  values?: Values
): PrioritizationItem {
  if (!backlogItemId) return row;
  const item = findBacklogItem(backlogItemId);
  if (!item) return row;
  const changes = inputChanges(item, row, values ? clearedKeys(values) : []);
  if (hasChanges(changes)) {
    let written: BacklogItem | undefined;
    const baseline = undoBaseline(item);
    undoable({
      label: `Updated “${shortName(item.name)}” in the backlog`,
      apply: () => {
        written = applyInputs(item, changes);
      },
      revert: () => restoreInputs(item, written, baseline),
    });
  }
  return { ...row, backlogItemId: item.id };
}

/**
 * Save a method row's inputs (a tool's edit, a drag on the matrix): the row
 * with `values` written over what it shows and the engine's score cached,
 * and, when it is linked to a backlog item and the method is one the
 * backlog holds, the item's owned fields written through, both in one
 * undoable. Undo puts back only what is still as written (the item, the
 * row and any other row the rename reached). An unlinked row (or a method
 * the backlog doesn't hold) is a plain save with no toast.
 *
 * `values` merge over the inputs the row shows, read through to its item
 * (effectiveFields), never over the row's own stale copy: an input left
 * out keeps what the hub or an agent last wrote. An input present as
 * undefined is a clear (a form's blanked input): the row drops it and, for
 * a linked row of a method the backlog holds, so does the item.
 *
 * `title`, when given, renames the row (and its item, renameEverywhere).
 * Returns the stored row, or undefined when the row is gone.
 */
export function saveMethodRow(
  rowId: string,
  values: Values,
  opts: { title?: string; label?: string } = {}
): PrioritizationItem | undefined {
  const cur = findRow(rowId);
  const m = cur ? methodFor(cur.framework) : undefined;
  if (!cur || !m) return undefined;
  const now = new Date().toISOString();
  const title = opts.title?.trim() ? opts.title : cur.title;
  const item = linkedItem(cur, ws().backlogItems ?? []);
  const merged: Values = { ...m.read(effectiveFields(cur, item)), ...values };
  const nextRow = methodRow({
    id: cur.id,
    framework: m.id,
    title,
    values: merged,
    prev: cur,
    now,
  });
  const changes: Partial<BacklogItem> =
    item && m.embedded
      ? itemPatchChanges(
          itemSaveBase(item),
          ownedPatch(m.id, m.read(nextRow.fields), clearedKeys(values))
        )
      : {};
  const renamed = item && nextRow.title !== cur.title ? nextRow.title : undefined;
  if (renamed && item && renamed !== item.name) changes.name = renamed;

  if (!item || !hasChanges(changes)) {
    ws().upsertPrioritization(nextRow);
    if (renamed && item) renameLinkedRows(item.id, renamed, rowId);
    return nextRow;
  }

  let written: BacklogItem | undefined;
  let siblings: RenamedRow[] = [];
  const baseline = undoBaseline(item);
  undoable({
    label: opts.label ?? `Updated “${shortName(item.name)}” in the backlog`,
    apply: () => {
      ws().upsertPrioritization(nextRow);
      written = applyInputs(item, changes, rowId);
      siblings = renamed ? renameLinkedRows(item.id, renamed, rowId) : [];
    },
    revert: () => {
      restoreInputs(item, written, baseline);
      const now2 = findRow(rowId);
      // The row goes back only if nobody saved it since.
      if (now2 && now2.updatedAt === nextRow.updatedAt) ws().upsertPrioritization(cur);
      restoreRenamedRows(siblings);
    },
  });
  return nextRow;
}

/**
 * "Add to backlog" for an unlinked row: create a backlog item from the
 * row's title and inputs and link the row to it. When the backlog already
 * has an item with the same name, the row links to that one instead of
 * making a duplicate. Undo removes the new item (or restores the existing
 * one's inputs) and the link. Returns the backlog item id.
 */
export function addRowToBacklog(row: PrioritizationItem): string {
  const m = methodFor(row.framework);
  const patch = m && m.embedded ? ownedPatch(m.id, m.read(row.fields)) : {};
  const linkRow = (backlogItemId: string) => {
    const cur = findRow(row.id) ?? row;
    ws().upsertPrioritization({ ...cur, backlogItemId, updatedAt: new Date().toISOString() });
  };

  const name = normalize(row.title);
  const existing = name
    ? (ws().backlogItems ?? []).find((b) => normalize(b.name ?? "") === name)
    : undefined;

  if (existing) {
    const changes = itemPatchChanges(itemSaveBase(existing), patch);
    let written: BacklogItem | undefined;
    const baseline = undoBaseline(existing);
    undoable({
      label: `Linked “${shortName(row.title)}” to the backlog`,
      apply: () => {
        written = applyInputs(existing, changes);
        linkRow(existing.id);
      },
      revert: () => {
        restoreInputs(existing, written, baseline);
        unlinkRow(row.id, existing.id);
      },
    });
    return existing.id;
  }

  const item = createBacklogItem(row.title, patch);
  undoable({
    label: `Added “${shortName(row.title)}” to the backlog`,
    apply: () => {
      ws().upsertBacklogItem(item);
      linkRow(item.id);
    },
    // Removing the item also unlinks every row that points at it.
    revert: () => ws().removeBacklogItem(item.id),
  });
  return item.id;
}

/** A row renameLinkedRows retitled: as it was, and the stamp the rename wrote. */
export interface RenamedRow {
  before: PrioritizationItem;
  updatedAt: string;
}

/**
 * After a backlog item is renamed, give its linked rows the new title
 * (`except` is a row already saved with it). Returns the rows it changed,
 * so an Undo can put their old titles back (restoreRenamedRows).
 */
export function renameLinkedRows(
  backlogItemId: string,
  name: string,
  except?: string
): RenamedRow[] {
  const title = name.trim().slice(0, 200);
  if (!title) return [];
  const now = new Date().toISOString();
  const out: RenamedRow[] = [];
  for (const row of ws().prioritizations ?? []) {
    if (row.id === except) continue;
    if (row.backlogItemId === backlogItemId && row.title !== title) {
      ws().upsertPrioritization({ ...row, title, updatedAt: now });
      out.push({ before: row, updatedAt: now });
    }
  }
  return out;
}

/** Undo renameLinkedRows: each row back as it was, unless someone saved it since. */
function restoreRenamedRows(renamed: readonly RenamedRow[]): void {
  for (const r of renamed) {
    const now = findRow(r.before.id);
    if (now && now.updatedAt === r.updatedAt) ws().upsertPrioritization(r.before);
  }
}

/**
 * Rename a backlog item and every row linked to it, from the hub or a
 * method tool: one name everywhere. A blank name changes nothing.
 */
export function renameEverywhere(backlogItemId: string, name: string): void {
  const title = name.trim().slice(0, 200);
  if (!title) return;
  const item = findBacklogItem(backlogItemId);
  if (item && item.name !== title) saveBacklogItem(backlogItemId, { name: title });
  renameLinkedRows(backlogItemId, title);
}

/**
 * Delete a backlog item with Undo. The store's removeBacklogItem freezes a
 * copy of the values each linked row showed (so a WSJF row keeps its
 * scores) and unlinks the rows; Undo brings the item back and re-links
 * those rows.
 */
export function removeBacklogItemWithUndo(id: string, onRemoved?: () => void): void {
  const item = findBacklogItem(id);
  if (!item) return;
  const linkedRowIds = new Set(
    (ws().prioritizations ?? []).filter((p) => p.backlogItemId === id).map((p) => p.id)
  );
  undoable({
    label: `Deleted “${shortName(item.name)}”`,
    apply: () => {
      ws().removeBacklogItem(id);
      onRemoved?.();
    },
    revert: () => {
      if (!findBacklogItem(id)) ws().upsertBacklogItem(item);
      for (const row of ws().prioritizations ?? []) {
        if (linkedRowIds.has(row.id) && !row.backlogItemId) {
          ws().upsertPrioritization({ ...row, backlogItemId: id });
        }
      }
    },
  });
}
