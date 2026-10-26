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
import {
  removeBacklogItemWithUndo,
  renameEverywhere,
  saveBacklogItem,
} from "@/lib/prioritization/backlog-links";
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
    // Saved through the engine's path (old defaults cleared, stamped), so
    // the method tools reading through to the item show the edit at once.
    updateItem: (id, updates) => {
      const cur = (useWorkspaceStore.getState().backlogItems ?? []).find((item) => item.id === id);
      if (!cur) return;
      const { name, ...rest } = updates;
      if (Object.keys(rest).length > 0) saveBacklogItem(id, rest);
      if (name !== undefined && name !== cur.name) renameEverywhere(id, name);
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
