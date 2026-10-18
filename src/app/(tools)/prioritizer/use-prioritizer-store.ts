"use client";

/**
 * Backlog items are a synced workspace collection (`backlogItems`), the
 * shared backlog the prioritization method tools score. The collection kind
 * matches src/lib/actions/tools/prioritizer.ts.
 *
 * There is no seed: a new backlog is empty and the page offers "Load an
 * example". (The old `defaultItems` seed never ran, because the workspace
 * starts with `backlogItems: []`, and "Reset to defaults" wiped the whole
 * collection without asking.)
 */

import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { removeBacklogItemWithUndo, renameLinkedRows } from "@/lib/prioritization/backlog-links";
import type { BacklogItem, PrioritizerStore } from "./types";
import { createDefaultItem } from "./constants";
import { buildExample, isExampleBacklogId } from "./example";

const NO_ITEMS: BacklogItem[] = [];

export function usePrioritizerStore(): PrioritizerStore {
  const raw = useWorkspaceStore(useShallow((s) => s.backlogItems));
  const upsert = useWorkspaceStore((s) => s.upsertBacklogItem);

  return {
    items: raw ?? NO_ITEMS,
    addItem: () => upsert(createDefaultItem()),
    updateItem: (id, updates) => {
      const cur = (useWorkspaceStore.getState().backlogItems ?? []).find((item) => item.id === id);
      if (!cur) return;
      upsert({ ...cur, ...updates });
      if (updates.name !== undefined && updates.name !== cur.name) {
        renameLinkedRows(id, updates.name);
      }
    },
    removeItem: (id) => removeBacklogItemWithUndo(id),
    loadExample: () => {
      const have = new Set((useWorkspaceStore.getState().backlogItems ?? []).map((b) => b.id));
      for (const item of buildExample()) if (!have.has(item.id)) upsert(item);
    },
    clearExample: () => {
      const { backlogItems, removeBacklogItem } = useWorkspaceStore.getState();
      for (const item of backlogItems ?? []) {
        if (isExampleBacklogId(item.id)) removeBacklogItem(item.id);
      }
    },
  };
}
