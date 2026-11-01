/**
 * Writes to the tech-debt items, in the browser: the Risk Register store's
 * shape (lib/risks/store) for workspace.techDebt. Each helper reads the
 * workspace at the moment it writes, every save stamps `updatedAt` (the
 * move then treats the workspace's copy as the newer one), a row of the old
 * blob still waiting for the page's move is listed and edited as it will
 * read once moved, and a delete marks such a row moved so the move doesn't
 * bring it back. The blob, the backup, is never written here.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TechDebtItem, WhiteboardObject } from "@/lib/stores/workspace-types";
import { setCloudPersistedValue } from "@/lib/sync/use-cloud-persisted";
import {
  TECH_DEBT_KEY,
  TECH_DEBT_MOVED_KEY,
  isPendingTechDebtRow,
  withPendingTechDebt,
} from "./legacy";

/** A cloud-persisted value as this browser holds it (mirrored to localStorage), or null. */
function readLocal(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

const idsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

/**
 * Every item the Tech Debt page lists right now: the workspace's, and the
 * old blob's rows still waiting for the page's one-time move, as they will
 * read once moved.
 */
export function currentTechDebt(): TechDebtItem[] {
  return withPendingTechDebt(
    useWorkspaceStore.getState().techDebt ?? [],
    readLocal(TECH_DEBT_KEY),
    idsOf(readLocal(TECH_DEBT_MOVED_KEY))
  );
}

/**
 * Save several items in one store write (the page's move: its toAdd and
 * toFill, the rows it only reports included, whose stamp settles them),
 * each stamped `updatedAt`: each replaces the item with its id, and new
 * ones go first, newest-first as the page always listed them. Returns them
 * as saved.
 */
export function saveTechDebt(list: readonly TechDebtItem[]): TechDebtItem[] {
  if (list.length === 0) return [];
  const at = new Date().toISOString();
  const saved = list.map((t) => ({ ...t, updatedAt: at }));
  useWorkspaceStore.setState((s) => {
    const byId = new Map(saved.map((t) => [t.id, t]));
    const kept = (s.techDebt ?? []).map((t) => {
      const next = byId.get(t.id);
      if (next) byId.delete(t.id);
      return next ?? t;
    });
    return { techDebt: [...Array.from(byId.values()), ...kept] };
  });
  return saved;
}

/** Save one item under its id, stamped `updatedAt` (a new one goes first). Returns it as saved. */
export function saveDebt(t: TechDebtItem): TechDebtItem {
  return saveTechDebt([t])[0];
}

/**
 * Change one item with `fn`, given the item as the page lists it now
 * (currentTechDebt), so a row still waiting for the move is edited with
 * its old-page fields folded in. Returns it as saved, or null for an
 * unknown id (nothing is written).
 */
export function patchDebt(id: string, fn: (t: TechDebtItem) => TechDebtItem): TechDebtItem | null {
  const current = currentTechDebt().find((t) => t.id === id);
  return current ? saveDebt(fn(current)) : null;
}

/** What `removeTechDebtRecord` took away, so Undo can put it back. */
export interface TechDebtRecordSnapshot {
  id: string;
  /** The workspace row, when the workspace held one. */
  item?: TechDebtItem;
  /** Set when the id was an old blob row still waiting for the move, which the delete marked moved. */
  pendingBlobRow?: true;
  /** Canvas cards the remove unpinned, with the link each had. */
  cards: { id: string; sourceRef: NonNullable<WhiteboardObject["sourceRef"]> }[];
}

/** The canvas tool a debt item's cards point at it through (workspace-store removeTechDebt). */
const CARD_TOOL = "techDebt";

/**
 * Remove an item and return what went, for `restoreTechDebtRecord`. An old
 * blob row the move hasn't handled yet is marked moved first, so neither
 * the list nor the move brings it back. Canvas cards pinned to it are
 * unpinned by the store's remove; the snapshot keeps their links.
 */
export function removeTechDebtRecord(id: string): TechDebtRecordSnapshot {
  const ws = useWorkspaceStore.getState();
  const item = (ws.techDebt ?? []).find((t) => t.id === id);
  const cards = (ws.whiteboardObjects ?? []).flatMap((o) =>
    o.sourceRef && o.sourceRef.tool === CARD_TOOL && o.sourceRef.entityId === id
      ? [{ id: o.id, sourceRef: o.sourceRef }]
      : []
  );
  const moved = idsOf(readLocal(TECH_DEBT_MOVED_KEY));
  const pendingBlobRow = isPendingTechDebtRow(id, readLocal(TECH_DEBT_KEY), moved);
  // Marked first, so no reader sees the blob's copy come back in between.
  if (pendingBlobRow) setCloudPersistedValue(TECH_DEBT_MOVED_KEY, [...moved, id]);
  if (item) ws.removeTechDebt(id);
  return {
    id,
    ...(item ? { item } : {}),
    ...(pendingBlobRow ? { pendingBlobRow: true as const } : {}),
    cards,
  };
}

/**
 * Put back what `removeTechDebtRecord` took (Undo): the workspace row as it
 * was unless one came back under the id since, a blob row waiting for the
 * move again, and the cards still there and unpinned re-pinned.
 */
export function restoreTechDebtRecord(snapshot: TechDebtRecordSnapshot): void {
  const ws = useWorkspaceStore.getState();
  const { id, item, pendingBlobRow, cards } = snapshot;
  if (item && !(ws.techDebt ?? []).some((t) => t.id === id)) ws.upsertTechDebt(item);
  if (pendingBlobRow) {
    const moved = idsOf(readLocal(TECH_DEBT_MOVED_KEY));
    if (moved.includes(id)) {
      setCloudPersistedValue(
        TECH_DEBT_MOVED_KEY,
        moved.filter((m) => m !== id)
      );
    }
  }
  if (cards.length === 0) return;
  const objects = new Map(
    (useWorkspaceStore.getState().whiteboardObjects ?? []).map((o) => [o.id, o])
  );
  const at = new Date().toISOString();
  const back = cards.flatMap(({ id: objectId, sourceRef }) => {
    const o = objects.get(objectId);
    // version + updatedAt bump so peers accept the change (last write wins).
    return o && !o.sourceRef ? [{ ...o, sourceRef, version: o.version + 1, updatedAt: at }] : [];
  });
  if (back.length > 0) useWorkspaceStore.getState().upsertWhiteboardObjects(back);
}
