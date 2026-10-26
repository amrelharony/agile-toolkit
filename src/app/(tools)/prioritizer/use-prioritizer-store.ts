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

import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  removeBacklogItemWithUndo,
  renameEverywhere,
  saveBacklogItem,
} from "@/lib/prioritization/backlog-links";
import { createBacklogItem } from "@/lib/prioritization/frameworks";
import { ranksFromOrder } from "@/lib/prioritization/rank";
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
      const patch = scorePatch(methodId, values, cur);
      saveBacklogItem(id, patch);
      return patch;
    },
    removeItem: (id) => removeBacklogItemWithUndo(id),
    saveOrder: (ids, label) => {
      const ranks = ranksFromOrder(ids.filter((id) => current().some((i) => i.id === id)));
      const before = new Map(current().map((i) => [i.id, rankOf(i)]));
      // What this save wrote, so Undo puts back only ranks nobody has changed since.
      const written = new Map<string, number | undefined>();
      undoable({
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
          for (const [id, rank] of Array.from(written.entries())) {
            const now = current().find((i) => i.id === id);
            if (now && rankOf(now) === rank) saveBacklogItem(id, { rank: before.get(id) });
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
