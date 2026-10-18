/**
 * Backlog Prioritizer — shared types.
 *
 * Backlog items are a synced workspace collection (`backlogItems`); these
 * types describe one row + the store-hook surface the UI consumes.
 */

import type { BacklogItem } from "@/lib/stores/workspace-types";

export type { BacklogItem };

export type MoSCoWCategory = BacklogItem["moscow"];

export const IMPACT_VALUES = [0.25, 0.5, 1, 2, 3] as const;
export type ImpactValue = (typeof IMPACT_VALUES)[number];

export interface PrioritizerStore {
  items: BacklogItem[];
  addItem: () => void;
  /** Renaming an item also renames the method rows linked to it. */
  updateItem: (id: string, updates: Partial<Omit<BacklogItem, "id">>) => void;
  /** Deletes with Undo; the rows that scored it stay, unlinked. */
  removeItem: (id: string) => void;
  /** Adds the example backlog (ids start with `example-`). */
  loadExample: () => void;
  /** Removes only example rows, including legacy `default:item-*` seeds. */
  clearExample: () => void;
}
