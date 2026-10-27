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
 *
 * Every write goes through the engine's save (lib/prioritization/
 * backlog-links saveBacklogItem → binding applyItemPatch): old "Add item"
 * defaults cleared, `updatedAt` stamped. The method tools' rows linked to
 * an item read its inputs through, so a hub edit shows there at once and
 * nothing is copied to them.
 */

import { useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  itemSaveBase,
  removeBacklogItemWithUndo,
  renameEverywhere,
  saveBacklogItem,
} from "@/lib/prioritization/backlog-links";
import { itemPatchChanges } from "@/lib/prioritization/binding";
import { createBacklogItem } from "@/lib/prioritization/frameworks";
import { ranksFromOrder } from "@/lib/prioritization/rank";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import type { BacklogItem, PrioritizerStore } from "./types";
import { buildExample, isExampleBacklogId } from "./example";
import { scorePatch } from "./hub-form";
import { rankOf } from "./order";

const NO_ITEMS: BacklogItem[] = [];

const current = () => useWorkspaceStore.getState().backlogItems ?? NO_ITEMS;

export function usePrioritizerStore(): PrioritizerStore {
  const raw = useWorkspaceStore(useShallow((s) => s.backlogItems));
  const upsert = useWorkspaceStore((s) => s.upsertBacklogItem);
  // The last saved order's Undo toast: a newer order replaces it.
  const orderToast = useRef<string | number | undefined>(undefined);

  return {
    items: raw ?? NO_ITEMS,
    addItem: (name, description) => {
      const item = createBacklogItem(name, description ? { description } : {});
      upsert(item);
      return item;
    },
    updateItem: (id, updates) => {
      const cur = current().find((item) => item.id === id);
      if (!cur) return;
      const { name, ...rest } = updates;
      if (Object.keys(rest).length > 0) saveBacklogItem(id, rest);
      if (name !== undefined && name !== cur.name) renameEverywhere(id, name);
    },
    saveScores: (id, methodId, values) => {
      const cur = current().find((item) => item.id === id);
      if (!cur) return {};
      // The item as saveBacklogItem saves it: with what its links made
      // before Phase 7 still hold, so the changes logged are the ones written.
      const base = itemSaveBase(cur);
      const patch = scorePatch(methodId, values, base);
      // What the save changes (saveBacklogItem writes only that): an
      // editor saved as it was is no change, and nothing to log.
      const changes = itemPatchChanges(base, patch);
      saveBacklogItem(id, patch);
      return changes;
    },
    removeItem: (id) => removeBacklogItemWithUndo(id),
    saveOrder: (ids, label) => {
      const ranks = ranksFromOrder(ids.filter((id) => current().some((i) => i.id === id)));
      const before = new Map(current().map((i) => [i.id, rankOf(i)]));
      // What this save wrote, so Undo can tell whether the order changed since.
      const written = new Map<string, number | undefined>();
      // Undoing an older order after a newer one would mix the two (two
      // items on one rank): the newer order's toast replaces the older's.
      if (orderToast.current !== undefined) toast.dismiss(orderToast.current);
      orderToast.current = undoable({
        label,
        apply: () => {
          for (const item of current()) {
            const next = ranks.get(item.id);
            if (next === rankOf(item)) continue;
            saveBacklogItem(item.id, { rank: next });
            written.set(item.id, next);
          }
        },
        revert: () => {
          // All or nothing: a rank this save wrote that has changed since
          // (another order, the agent's set_order) means putting the others
          // back would leave two items on one rank. A deleted item is no
          // conflict: it has no rank to clash.
          const entries = Array.from(written.entries());
          const changed = entries.some(([id, rank]) => {
            const now = current().find((i) => i.id === id);
            return now !== undefined && rankOf(now) !== rank;
          });
          if (changed) {
            toast("Not undone: the order has changed since. Decide order again to change it.");
            return;
          }
          for (const [id] of entries) {
            if (current().some((i) => i.id === id)) saveBacklogItem(id, { rank: before.get(id) });
          }
        },
      });
    },
    loadExample: () => {
      const have = new Set(current().map((b) => b.id));
      for (const item of buildExample()) if (!have.has(item.id)) upsert(item);
    },
    clearExample: () => {
      const { removeBacklogItem } = useWorkspaceStore.getState();
      for (const item of current()) {
        if (isExampleBacklogId(item.id)) removeBacklogItem(item.id);
      }
    },
  };
}
