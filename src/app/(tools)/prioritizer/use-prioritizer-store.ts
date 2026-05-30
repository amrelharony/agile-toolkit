"use client";

/**
 * Backlog items are a synced workspace collection (were an isolated
 * localStorage zustand store), so MCP-written items round-trip into the UI.
 * `usePrioritizerStore` preserves the prior store's API. The deterministic
 * `defaultItems` seed is written into the store on first mount (when the slice
 * is still undefined) so SSR/first-paint matches and update/remove operate on
 * real rows. The collection kind matches src/lib/actions/tools/prioritizer.ts.
 */

import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizerStore } from "./types";
import { createDefaultItem, defaultItems } from "./constants";

export function usePrioritizerStore(): PrioritizerStore {
  const raw = useWorkspaceStore(useShallow((s) => s.backlogItems));
  const upsert = useWorkspaceStore((s) => s.upsertBacklogItem);
  const removeItem = useWorkspaceStore((s) => s.removeBacklogItem);

  // Seed the deterministic defaults once, only if the user has never had a
  // backlog (slice undefined). An explicit empty array is respected.
  useEffect(() => {
    if (useWorkspaceStore.getState().backlogItems === undefined) {
      useWorkspaceStore.setState({ backlogItems: defaultItems });
    }
  }, []);

  return {
    items: raw ?? defaultItems,
    addItem: () => upsert(createDefaultItem()),
    updateItem: (id, updates) => {
      const cur = (useWorkspaceStore.getState().backlogItems ?? defaultItems).find(
        (item) => item.id === id
      );
      if (cur) upsert({ ...cur, ...updates });
    },
    removeItem: (id) => removeItem(id),
    reset: () => useWorkspaceStore.setState({ backlogItems: defaultItems }),
  };
}
