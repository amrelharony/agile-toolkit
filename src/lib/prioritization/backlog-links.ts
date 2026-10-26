/**
 * Writes that link method rows to the shared backlog (the browser side of
 * ./binding's live two-way binding).
 *
 * Every write reads the freshest workspace state right before it and goes
 * through the store's upsert/remove actions. A backlog item is always
 * saved through `applyItemPatch` (old-default fingerprints cleared,
 * `updatedAt` stamped). Cross-tool writes (creating a backlog item, writing
 * a row's inputs to it) run inside `undoable`, and Undo puts back only what
 * nobody has changed since: a hub edit made inside the Undo window stays.
 *
 * Client-only (undoable shows a toast): the agent actions apply ./binding
 * on the server instead.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import {
  applyItemPatch,
  frozenRow,
  itemPatchChanges,
  linkedItem,
  methodRow,
  ownedPatch,
} from "./binding";
import { createBacklogItem } from "./frameworks";
import { methodFor, type Values } from "./methods";

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

/** The backlog fields a row's stored inputs set, limited to the ones that change the item. */
function inputChanges(item: BacklogItem, row: PrioritizationItem): Partial<BacklogItem> {
  const m = methodFor(row.framework);
  if (!m || !m.embedded) return {};
  return itemPatchChanges(item, ownedPatch(m.id, m.read(row.fields)));
}

const hasChanges = (changes: Partial<BacklogItem>) => Object.keys(changes).length > 0;

/** Write `changes` onto the freshest copy of the backlog item; returns what was stored. */
function applyInputs(item: BacklogItem, changes: Partial<BacklogItem>): BacklogItem | undefined {
  if (!hasChanges(changes)) return undefined;
  const cur = findBacklogItem(item.id) ?? item;
  const next = applyItemPatch(cur, changes);
  ws().upsertBacklogItem(next);
  return next;
}

/**
 * Put back the fields `written` overwrote, as they were on `before`, but
 * only those whose current value is still what was written: an edit made
 * since (in the hub, by an agent) is never clobbered.
 */
function restoreInputs(before: BacklogItem, written: BacklogItem | undefined): void {
  if (!written) return;
  const cur = findBacklogItem(before.id);
  if (!cur) return;
  const back: Record<string, unknown> = { ...cur };
  let changed = false;
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(written)]));
  for (const key of keys) {
    if (key === "id") continue;
    const k = key as keyof BacklogItem;
    if (written[k] === before[k] || cur[k] !== written[k]) continue;
    if (before[k] === undefined) delete back[key];
    else back[key] = before[k];
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
 * old-default fingerprints unset and `updatedAt` stamped. A patch that
 * changes nothing the engine reads writes nothing. Returns the stored item.
 */
export function saveBacklogItem(id: string, patch: Partial<BacklogItem>): BacklogItem | undefined {
  const cur = findBacklogItem(id);
  if (!cur) return undefined;
  const changes = itemPatchChanges(cur, patch);
  if (!hasChanges(changes)) return cur;
  const next = applyItemPatch(cur, changes);
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
 */
export function linkNewRow(
  row: PrioritizationItem,
  backlogItemId: string | null | undefined
): PrioritizationItem {
  if (!backlogItemId) return row;
  const item = findBacklogItem(backlogItemId);
  if (!item) return row;
  const changes = inputChanges(item, row);
  if (hasChanges(changes)) {
    let written: BacklogItem | undefined;
    undoable({
      label: `Updated “${shortName(item.name)}” in the backlog`,
      apply: () => {
        written = applyInputs(item, changes);
      },
      revert: () => restoreInputs(item, written),
    });
  }
  return { ...row, backlogItemId: item.id };
}

/**
 * Save a method row's inputs (a tool's edit, a drag on the matrix): the row
 * with `values` written over its fields and the engine's score cached, and,
 * when it is linked to a backlog item and the method is one the backlog
 * holds, the item's owned fields written through, both in one undoable.
 * Undo puts back only what is still as written. An unlinked row (or a
 * method the backlog doesn't hold) is a plain save with no toast.
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
  const nextRow = methodRow({
    id: cur.id,
    framework: m.id,
    title,
    values: { ...m.read(cur.fields), ...values },
    prev: cur,
    now,
  });
  const item = linkedItem(cur, ws().backlogItems ?? []);
  const changes: Partial<BacklogItem> =
    item && m.embedded ? itemPatchChanges(item, ownedPatch(m.id, m.read(nextRow.fields))) : {};
  const renamed = item && nextRow.title !== cur.title ? nextRow.title : undefined;
  if (renamed && item && renamed !== item.name) changes.name = renamed;

  if (!item || !hasChanges(changes)) {
    ws().upsertPrioritization(nextRow);
    if (renamed && item) renameLinkedRows(item.id, renamed, rowId);
    return nextRow;
  }

  let written: BacklogItem | undefined;
  undoable({
    label: opts.label ?? `Updated “${shortName(item.name)}” in the backlog`,
    apply: () => {
      ws().upsertPrioritization(nextRow);
      written = applyInputs(item, changes);
      if (renamed) renameLinkedRows(item.id, renamed, rowId);
    },
    revert: () => {
      restoreInputs(item, written);
      const now2 = findRow(rowId);
      // The row goes back only if nobody saved it since.
      if (now2 && now2.updatedAt === nextRow.updatedAt) ws().upsertPrioritization(cur);
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
    const changes = itemPatchChanges(existing, patch);
    let written: BacklogItem | undefined;
    undoable({
      label: `Linked “${shortName(row.title)}” to the backlog`,
      apply: () => {
        written = applyInputs(existing, changes);
        linkRow(existing.id);
      },
      revert: () => {
        restoreInputs(existing, written);
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

/**
 * After a backlog item is renamed, give its linked rows the new title
 * (`except` is a row already saved with it).
 */
export function renameLinkedRows(backlogItemId: string, name: string, except?: string): void {
  const title = name.trim().slice(0, 200);
  if (!title) return;
  const now = new Date().toISOString();
  for (const row of ws().prioritizations ?? []) {
    if (row.id === except) continue;
    if (row.backlogItemId === backlogItemId && row.title !== title) {
      ws().upsertPrioritization({ ...row, title, updatedAt: now });
    }
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
 * Delete a backlog item with Undo. Each row that read through to it first
 * freezes a copy of the values it showed (so a WSJF row keeps its scores),
 * then the store unlinks the rows; Undo brings the item back and re-links
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
      const fresh = findBacklogItem(id) ?? item;
      const now = new Date().toISOString();
      for (const row of ws().prioritizations ?? []) {
        if (row.backlogItemId !== id) continue;
        const frozen = frozenRow(row, fresh, now);
        if (frozen !== row) ws().upsertPrioritization(frozen);
      }
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
