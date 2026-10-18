/**
 * Writes that link method rows to the shared backlog.
 *
 * Every write reads the freshest workspace state right before it and goes
 * through the store's upsert/remove actions. Cross-tool writes (creating a
 * backlog item, overwriting its inputs) run inside `undoable`, and Undo
 * removes both the created item and the link.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import { changedFields, createBacklogItem, frameworkFor } from "./frameworks";

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
  return row.backlogItemId ? items.find((b) => b.id === row.backlogItemId) : undefined;
}

/** The backlog inputs a row would write, limited to the ones that differ. */
function inputChanges(item: BacklogItem, row: PrioritizationItem): Partial<BacklogItem> {
  const patch = frameworkFor(row.framework)?.toBacklog?.(row.fields) ?? {};
  return changedFields(item, patch);
}

const hasChanges = (changes: Partial<BacklogItem>) => Object.keys(changes).length > 0;

/** Write `changes` onto the freshest copy of the backlog item. */
function applyInputs(item: BacklogItem, changes: Partial<BacklogItem>): void {
  if (!hasChanges(changes)) return;
  const cur = findBacklogItem(item.id) ?? item;
  ws().upsertBacklogItem({ ...cur, ...changes });
}

/** Put back the fields `changes` overwrote, as they were on `before`. */
function restoreInputs(before: BacklogItem, changes: Partial<BacklogItem>): void {
  const cur = findBacklogItem(before.id);
  if (!cur || !hasChanges(changes)) return;
  const back: Record<string, unknown> = { ...cur };
  for (const key of Object.keys(changes)) back[key] = before[key as keyof BacklogItem];
  ws().upsertBacklogItem(back as unknown as BacklogItem);
}

function unlinkRow(rowId: string, backlogItemId: string): void {
  const cur = findRow(rowId);
  if (!cur || cur.backlogItemId !== backlogItemId) return;
  const next: PrioritizationItem = { ...cur };
  delete next.backlogItemId;
  ws().upsertPrioritization(next);
}

/**
 * Link a row that is about to be added to the backlog item the user
 * imported it from. Returns the row to upsert.
 *
 * For methods the backlog holds inputs for, the row's inputs are written to
 * the backlog item now (once, not kept in sync), so each hub cell has one
 * source. That write is undoable. A missing item leaves the row unlinked.
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
    undoable({
      label: `Updated “${shortName(item.name)}” in the backlog`,
      apply: () => applyInputs(item, changes),
      revert: () => restoreInputs(item, changes),
    });
  }
  return { ...row, backlogItemId: item.id };
}

/**
 * "Add to backlog" for an unlinked row: create a backlog item from the
 * row's title and inputs and link the row to it. When the backlog already
 * has an item with the same name, the row links to that one instead of
 * making a duplicate. Undo removes the new item (or restores the existing
 * one's inputs) and the link. Returns the backlog item id.
 */
export function addRowToBacklog(row: PrioritizationItem): string {
  const patch = frameworkFor(row.framework)?.toBacklog?.(row.fields) ?? {};
  const linkRow = (backlogItemId: string) => {
    const cur = findRow(row.id) ?? row;
    ws().upsertPrioritization({ ...cur, backlogItemId, updatedAt: new Date().toISOString() });
  };

  const name = normalize(row.title);
  const existing = name
    ? (ws().backlogItems ?? []).find((b) => normalize(b.name ?? "") === name)
    : undefined;

  if (existing) {
    const changes = changedFields(existing, patch);
    undoable({
      label: `Linked “${shortName(row.title)}” to the backlog`,
      apply: () => {
        applyInputs(existing, changes);
        linkRow(existing.id);
      },
      revert: () => {
        restoreInputs(existing, changes);
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

/** After a backlog item is renamed, give its linked rows the new title. */
export function renameLinkedRows(backlogItemId: string, name: string): void {
  const title = name.trim().slice(0, 200);
  if (!title) return;
  const now = new Date().toISOString();
  for (const row of ws().prioritizations ?? []) {
    if (row.backlogItemId === backlogItemId && row.title !== title) {
      ws().upsertPrioritization({ ...row, title, updatedAt: now });
    }
  }
}

/**
 * Delete a backlog item with Undo. The store unlinks the rows that scored
 * it; Undo brings the item back and re-links those rows.
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
