/**
 * Backlog Prioritizer — shared types.
 *
 * Backlog items are a synced workspace collection (`backlogItems`); these
 * types describe one row + the store-hook surface the UI consumes.
 */

import type { BacklogItem } from "@/lib/stores/workspace-types";
import type { Values } from "@/lib/prioritization/methods";
import type { HubMethodId } from "./hub-form";

export type { BacklogItem };

export type MoSCoWCategory = NonNullable<BacklogItem["moscow"]>;

export const IMPACT_VALUES = [0.25, 0.5, 1, 2, 3] as const;
export type ImpactValue = (typeof IMPACT_VALUES)[number];

export interface PrioritizerStore {
  items: BacklogItem[];
  /** Add an item with only a name (and a description): every method starts Not scored. */
  addItem: (name: string, description?: string) => BacklogItem;
  /** Renaming an item also renames the method rows linked to it. */
  updateItem: (id: string, updates: Partial<Omit<BacklogItem, "id">>) => void;
  /**
   * Save one method's inputs edited in the hub onto the item (a blank one
   * cleared). The method tools' linked rows read them through at once.
   * Returns the backlog fields it wrote.
   */
  saveScores: (id: string, methodId: HubMethodId, values: Values) => Partial<BacklogItem>;
  /** Deletes with Undo; the rows that scored it stay, unlinked, with their values. */
  removeItem: (id: string) => void;
  /**
   * Save a decided order: ranks 1..N to `ids`, every other item back to
   * Not ordered yet, in one undoable.
   */
  saveOrder: (ids: readonly string[], label: string) => void;
  /** Adds the example backlog (ids start with `example-`). */
  loadExample: () => void;
  /** Removes only example rows, including legacy `default:item-*` seeds. */
  clearExample: () => void;
}
